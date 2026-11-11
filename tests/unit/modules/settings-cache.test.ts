/**
 * app_settings 조회 캐시 + 저장/삭제 즉시 무효화.
 *
 * `next/cache` 는 태그 기반 인메모리 캐시로 대체한다(unstable_cache 와 같은
 * 의미: 인자별 항목, 콜백 reject 는 저장하지 않음, 태그 만료 시 재조회).
 *
 * 고정하는 계약:
 *  1. getSetting/getSettings 는 캐시된다(같은 키 반복 조회 = DB 1회, 키 순서 무관).
 *  2. setSetting/deleteSetting 은 `app-settings` 태그를 만료시킨다 → 저장 직후
 *     Toss 결제 경로(getEffectiveToss*)가 새 키를 쓰고, 삭제 직후 env 폴백/미설정.
 *  3. 서버 액션 밖(updateTag 불가)이면 revalidateTag 즉시 만료로 대체한다.
 *  4. 캐시 계층이 실패하면 DB 직접 조회로 폴백한다(결제가 막히지 않음).
 *  5. DB 오류 결과는 캐시하지 않는다(일시 오류가 null 로 고착되지 않음).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CacheEntry = { value: unknown; tags: string[] };

const h = vi.hoisted(() => {
  const state = {
    table: new Map<string, string>(),
    queryCount: 0,
    failNextQuery: false,
    cache: new Map<string, CacheEntry>(),
    cacheBroken: false,
    updateTagThrows: false,
    revalidateTagThrows: false,
    updateTagCalls: [] as string[],
    revalidateTagCalls: [] as Array<[string, unknown]>,
    dropTag(tag: string): void {
      for (const [k, entry] of state.cache) {
        if (entry.tags.includes(tag)) state.cache.delete(k);
      }
    },
    takeFailure(): { message: string } | null {
      if (!state.failNextQuery) return null;
      state.failNextQuery = false;
      return { message: 'connection reset' };
    },
  };
  return state;
});

vi.mock('next/cache', () => ({
  unstable_cache:
    <A extends unknown[], R>(
      fn: (...args: A) => Promise<R>,
      keyParts: string[],
      options: { tags?: string[] },
    ) =>
    async (...args: A): Promise<R> => {
      if (h.cacheBroken) {
        throw new Error('Invariant: incrementalCache missing in unstable_cache');
      }
      const key = `${keyParts.join(',')}-${JSON.stringify(args)}`;
      const hit = h.cache.get(key);
      if (hit) return hit.value as R;
      const value = await fn(...args);
      h.cache.set(key, { value, tags: options.tags ?? [] });
      return value;
    },
  updateTag: (tag: string): void => {
    h.updateTagCalls.push(tag);
    if (h.updateTagThrows) {
      throw new Error('updateTag can only be called from within a Server Action.');
    }
    h.dropTag(tag);
  },
  revalidateTag: (tag: string, profile: unknown): void => {
    h.revalidateTagCalls.push([tag, profile]);
    if (h.revalidateTagThrows) {
      throw new Error('Invariant: static generation store missing in revalidateTag');
    }
    h.dropTag(tag);
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, key: string) => ({
          maybeSingle: async () => {
            h.queryCount += 1;
            const error = h.takeFailure();
            if (error) return { data: null, error };
            const value = h.table.get(key);
            return { data: value === undefined ? null : { value }, error: null };
          },
        }),
        in: async (_column: string, keys: string[]) => {
          h.queryCount += 1;
          const error = h.takeFailure();
          if (error) return { data: null, error };
          return {
            data: keys
              .filter((k) => h.table.has(k))
              .map((k) => ({ key: k, value: h.table.get(k) })),
            error: null,
          };
        },
      }),
      upsert: async (row: { key: string; value: string }) => {
        h.table.set(row.key, row.value);
        return { error: null };
      },
      delete: () => ({
        eq: async (_column: string, key: string) => {
          h.table.delete(key);
          return { error: null };
        },
      }),
    }),
  }),
}));

import {
  APP_SETTINGS_TAG,
  deleteSetting,
  getSetting,
  getSettings,
  setSetting,
} from '@/lib/db/settings';
import { getEffectiveTossClientKey, getEffectiveTossSecretKey } from '@/lib/env';

const ENV_KEYS = ['NEXT_PUBLIC_TOSS_CLIENT_KEY', 'TOSS_SECRET_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  h.table.clear();
  h.cache.clear();
  h.queryCount = 0;
  h.failNextQuery = false;
  h.cacheBroken = false;
  h.updateTagThrows = false;
  h.revalidateTagThrows = false;
  h.updateTagCalls = [];
  h.revalidateTagCalls = [];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('조회 캐시', () => {
  it('getSetting: 같은 키 반복 조회는 DB 1회', async () => {
    h.table.set('admin_email', 'ops@example.com');
    await expect(getSetting('admin_email')).resolves.toBe('ops@example.com');
    await expect(getSetting('admin_email')).resolves.toBe('ops@example.com');
    expect(h.queryCount).toBe(1);
  });

  it('getSettings: 키 순서·중복과 무관하게 같은 캐시 항목을 쓴다', async () => {
    h.table.set('a', '1');
    h.table.set('b', '2');
    await expect(getSettings(['b', 'a'])).resolves.toEqual({ a: '1', b: '2' });
    await expect(getSettings(['a', 'b', 'a'])).resolves.toEqual({ a: '1', b: '2' });
    expect(h.queryCount).toBe(1);
  });

  it('빈 키 목록은 조회하지 않는다', async () => {
    await expect(getSettings([])).resolves.toEqual({});
    expect(h.queryCount).toBe(0);
  });
});

describe('저장 직후 Toss 결제 경로가 새 키를 쓴다', () => {
  it('setSetting → 태그 만료 → getEffectiveTossSecretKey 가 새 값', async () => {
    h.table.set('toss_secret_key', 'test_sk_old');
    await expect(getEffectiveTossSecretKey()).resolves.toBe('test_sk_old');

    // 무효화 없이 DB 만 바뀌면 캐시 값이 유지된다(캐시가 실제로 동작함을 확인).
    h.table.set('toss_secret_key', 'test_sk_bypass');
    await expect(getEffectiveTossSecretKey()).resolves.toBe('test_sk_old');

    await setSetting('toss_secret_key', 'live_sk_new');
    expect(h.updateTagCalls).toEqual([APP_SETTINGS_TAG]);
    await expect(getEffectiveTossSecretKey()).resolves.toBe('live_sk_new');
  });

  it('setSetting → getEffectiveTossClientKey 도 새 값', async () => {
    h.table.set('toss_client_key', 'test_ck_old');
    await expect(getEffectiveTossClientKey()).resolves.toBe('test_ck_old');
    await setSetting('toss_client_key', 'live_ck_new');
    await expect(getEffectiveTossClientKey()).resolves.toBe('live_ck_new');
  });

  it('setSetting 은 getSettings 캐시도 무효화한다', async () => {
    h.table.set('mail_from', 'A <a@example.com>');
    await expect(getSettings(['mail_from'])).resolves.toEqual({ mail_from: 'A <a@example.com>' });
    await setSetting('mail_from', 'B <b@example.com>');
    await expect(getSettings(['mail_from'])).resolves.toEqual({ mail_from: 'B <b@example.com>' });
  });
});

describe('deleteSetting — 삭제 직후 env 폴백/미설정', () => {
  it('삭제 후 env 미설정이면 시크릿 키 미설정 오류, 클라이언트 키 null', async () => {
    h.table.set('toss_secret_key', 'test_sk_db');
    h.table.set('toss_client_key', 'test_ck_db');
    await expect(getEffectiveTossSecretKey()).resolves.toBe('test_sk_db');
    await expect(getEffectiveTossClientKey()).resolves.toBe('test_ck_db');

    await deleteSetting('toss_secret_key');
    await deleteSetting('toss_client_key');

    expect(h.table.has('toss_secret_key')).toBe(false);
    expect(h.updateTagCalls).toEqual([APP_SETTINGS_TAG, APP_SETTINGS_TAG]);
    await expect(getEffectiveTossSecretKey()).rejects.toThrow('설정되지 않았습니다');
    await expect(getEffectiveTossClientKey()).resolves.toBeNull();
  });

  it('삭제 후 실값 env 가 있으면 env 값으로 동작', async () => {
    h.table.set('toss_secret_key', 'test_sk_db');
    await expect(getSetting('toss_secret_key')).resolves.toBe('test_sk_db');
    await deleteSetting('toss_secret_key');
    process.env.TOSS_SECRET_KEY = 'live_sk_env';
    await expect(getEffectiveTossSecretKey()).resolves.toBe('live_sk_env');
    await expect(getSetting('toss_secret_key')).resolves.toBeNull();
  });
});

describe('무효화 경로', () => {
  it('서버 액션 밖(updateTag 불가)이면 revalidateTag 즉시 만료로 대체', async () => {
    h.updateTagThrows = true;
    h.table.set('toss_secret_key', 'test_sk_old');
    await expect(getSetting('toss_secret_key')).resolves.toBe('test_sk_old');

    await setSetting('toss_secret_key', 'test_sk_new');
    expect(h.revalidateTagCalls).toEqual([[APP_SETTINGS_TAG, { expire: 0 }]]);
    await expect(getSetting('toss_secret_key')).resolves.toBe('test_sk_new');
  });

  it('요청 컨텍스트 밖(둘 다 불가)이어도 저장은 성공하고 경고만 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.updateTagThrows = true;
    h.revalidateTagThrows = true;
    await expect(setSetting('admin_email', 'ops@example.com')).resolves.toBeUndefined();
    expect(h.table.get('admin_email')).toBe('ops@example.com');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('폴백 · 오류', () => {
  it('캐시 계층 실패 → DB 직접 조회 (결제 키 해석 유지)', async () => {
    h.cacheBroken = true;
    h.table.set('toss_secret_key', 'test_sk_direct');
    h.table.set('mail_from', 'A <a@example.com>');
    await expect(getEffectiveTossSecretKey()).resolves.toBe('test_sk_direct');
    await expect(getSettings(['mail_from'])).resolves.toEqual({ mail_from: 'A <a@example.com>' });
    expect(h.queryCount).toBe(2);
  });

  it('DB 오류는 null 을 반환하되 캐시하지 않는다 (다음 조회에서 회복)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.table.set('toss_secret_key', 'test_sk_ok');
    h.failNextQuery = true;
    await expect(getSetting('toss_secret_key')).resolves.toBeNull();
    // 같은 오류로 직접 조회를 재시도하지 않는다(쿼리 1회).
    expect(h.queryCount).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    await expect(getSetting('toss_secret_key')).resolves.toBe('test_sk_ok');
  });

  it('getSettings DB 오류 → {} (캐시하지 않음)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.table.set('a', '1');
    h.failNextQuery = true;
    await expect(getSettings(['a'])).resolves.toEqual({});
    await expect(getSettings(['a'])).resolves.toEqual({ a: '1' });
  });
});
