/**
 * app_settings — 어드민 설정 키-값 CRUD (서비스롤 전용).
 *
 * RLS 정책이 false이므로 anon/auth 클라이언트로는 접근 불가.
 * 반드시 getServiceRoleSupabase() 사용.
 *
 * 캐시: 조회는 `unstable_cache`(tag `app-settings`, 60초)로 감싼다 — Toss 결제
 * 경로(getEffectiveToss*)가 호출마다 DB 를 왕복하지 않도록. setSetting/
 * deleteSetting 은 같은 태그를 즉시 만료시켜 저장 직후 결제 경로가 새 값을 쓴다.
 * 캐시 계층이 실패하면(요청 컨텍스트 밖·incrementalCache 부재 등) DB 를 직접
 * 조회한다 — 캐시 장애가 결제를 막지 않는다. DB 오류 결과는 캐시하지 않는다.
 */

import 'server-only';
import { revalidateTag, unstable_cache, updateTag } from 'next/cache';
import { getServiceRoleSupabase } from '@/lib/supabase/service';

/** 조회 캐시 무효화 태그 — setSetting/deleteSetting 이 즉시 만료시킨다. */
export const APP_SETTINGS_TAG = 'app-settings';

/**
 * 태그 무효화가 닿지 않는 인스턴스(다중 인스턴스 자체 호스팅)의 최대 지연.
 * 결제 키를 다루므로 짧게 둔다.
 */
const SETTINGS_REVALIDATE_SECONDS = 60;

/** DB 조회 실패 — 캐시 계층 실패와 구분해 직접 조회 재시도 없이 null/{} 처리. */
class SettingsQueryError extends Error {}

// ─── DB 직접 조회 (캐시 내부·폴백 공용) ──────────────────────────────────────

async function fetchSetting(key: string): Promise<string | null> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  // throw → unstable_cache 가 결과를 저장하지 않는다(일시 오류의 null 고착 방지).
  if (error) throw new SettingsQueryError(error.message);
  return data?.value ?? null;
}

async function fetchSettings(keys: string[]): Promise<Record<string, string>> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', keys);

  if (error) throw new SettingsQueryError(error.message);
  const result: Record<string, string> = {};
  for (const row of data ?? []) {
    result[row.key] = row.value;
  }
  return result;
}

const getSettingCached = unstable_cache(fetchSetting, ['app-settings:one'], {
  revalidate: SETTINGS_REVALIDATE_SECONDS,
  tags: [APP_SETTINGS_TAG],
});

const getSettingsCached = unstable_cache(fetchSettings, ['app-settings:many'], {
  revalidate: SETTINGS_REVALIDATE_SECONDS,
  tags: [APP_SETTINGS_TAG],
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 조회 캐시를 즉시 만료시킨다. 서버 액션이면 updateTag(read-your-own-writes),
 * 그 외 요청 컨텍스트(Route Handler 등)면 revalidateTag 즉시 만료로 대체.
 * 요청 컨텍스트 밖(스크립트)이면 무효화할 캐시도 없으므로 경고만 남긴다.
 */
function invalidateSettingsCache(): void {
  try {
    updateTag(APP_SETTINGS_TAG);
    return;
  } catch {
    // 서버 액션 밖 — 아래 revalidateTag 로 대체.
  }
  try {
    revalidateTag(APP_SETTINGS_TAG, { expire: 0 });
  } catch (err) {
    console.warn('[settings] cache invalidation skipped:', errorMessage(err));
  }
}

// ─── 단건 조회 ──────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  try {
    return await getSettingCached(key);
  } catch (err) {
    if (err instanceof SettingsQueryError) {
      console.error('[settings] getSetting error:', err.message);
      return null;
    }
    // 캐시 계층 실패 → DB 직접 조회로 폴백.
  }
  try {
    return await fetchSetting(key);
  } catch (err) {
    console.error('[settings] getSetting error:', errorMessage(err));
    return null;
  }
}

// ─── 복수 조회 ──────────────────────────────────────────────────────────────

export async function getSettings(
  keys: string[],
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  // 순서·중복과 무관하게 같은 캐시 항목을 쓰도록 정규화.
  const normalized = [...new Set(keys)].sort();
  try {
    return await getSettingsCached(normalized);
  } catch (err) {
    if (err instanceof SettingsQueryError) {
      console.error('[settings] getSettings error:', err.message);
      return {};
    }
    // 캐시 계층 실패 → DB 직접 조회로 폴백.
  }
  try {
    return await fetchSettings(normalized);
  } catch (err) {
    console.error('[settings] getSettings error:', errorMessage(err));
    return {};
  }
}

// ─── 단건 upsert ────────────────────────────────────────────────────────────

export async function setSetting(key: string, value: string): Promise<void> {
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from('app_settings').upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  if (error) {
    throw new Error(`[settings] setSetting failed for key "${key}": ${error.message}`);
  }
  invalidateSettingsCache();
}

// ─── 단건 삭제(unset) ───────────────────────────────────────────────────────

/**
 * 행 삭제 — 이후 조회는 null 이 되어 env 값(있으면)으로 폴백한다.
 * 없는 키 삭제는 no-op(오류 아님).
 */
export async function deleteSetting(key: string): Promise<void> {
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from('app_settings').delete().eq('key', key);
  if (error) {
    throw new Error(`[settings] deleteSetting failed for key "${key}": ${error.message}`);
  }
  invalidateSettingsCache();
}
