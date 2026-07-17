/**
 * lib/db/coupons — 쿠폰 데이터 접근 금전 경로 테스트 (FS-X-01, ADR-026).
 *
 * 핵심 계약: validate 경계(만료/최소금액/한도/재사용/부재 단일 표현),
 * consume 원자성(0행 = 소진 거부, 23505 = 회원 재사용 + used_count 원복),
 * release 보상(원장 삭제 + GREATEST(used_count-1, 0)), admin delete 게이트
 * (사용 이력 있으면 거부). 인메모리 페이크가 UNIQUE(coupon_id, user_id)와
 * CAS(WHERE used_count = 읽은 값) 시맨틱을 재현한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { CouponId, OrderNo, UserId } from '@/types/common';

// ---------- in-memory fake supabase ----------

type FakeCouponRow = {
  id: string;
  code: string;
  type: string;
  value: number;
  min_subtotal: number;
  expires_at: string | null;
  usage_limit: number | null;
  used_count: number;
  is_active: boolean;
  created_at: string;
};

type FakeRedemptionRow = {
  id: string;
  coupon_id: string;
  user_id: string;
  order_id: string | null;
};

const db: { coupons: FakeCouponRow[]; redemptions: FakeRedemptionRow[] } = {
  coupons: [],
  redemptions: [],
};

type Row = Record<string, unknown>;

function tableRows(table: string): Row[] {
  if (table === 'coupons') return db.coupons as unknown as Row[];
  if (table === 'coupon_redemptions') return db.redemptions as unknown as Row[];
  throw new Error(`Unmocked table: ${table}`);
}

/**
 * 최소 PostgREST 빌더 페이크 — eq 필터 누적 후 maybeSingle/await 시점에 실행.
 * update 는 필터 매칭 행에만 patch 를 적용(0행 = CAS 실패 재현), insert 는
 * coupon_redemptions 의 UNIQUE(coupon_id, user_id)를 재현해 23505 를 돌려준다.
 */
function makeBuilder(table: string) {
  type Op = 'select' | 'update' | 'insert' | 'delete';
  const state: {
    op: Op;
    patch: Row | null;
    insertRow: Row | null;
    filters: Array<[string, unknown]>;
    countMode: boolean;
  } = { op: 'select', patch: null, insertRow: null, filters: [], countMode: false };

  const matches = (r: Row): boolean =>
    state.filters.every(([k, v]) => r[k] === v);

  function exec(): { data: Row[]; error: { code?: string; message: string } | null; count: number | null } {
    const rows = tableRows(table);
    if (state.op === 'insert') {
      const row = state.insertRow as Row;
      if (table === 'coupon_redemptions') {
        const dup = db.redemptions.some(
          (r) => r.coupon_id === row.coupon_id && r.user_id === row.user_id,
        );
        if (dup) {
          return {
            data: [],
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            count: null,
          };
        }
        const created: FakeRedemptionRow = {
          id: `red-${db.redemptions.length + 1}`,
          coupon_id: row.coupon_id as string,
          user_id: row.user_id as string,
          order_id: null,
        };
        db.redemptions.push(created);
        return { data: [created as unknown as Row], error: null, count: null };
      }
      // coupons insert — code UNIQUE 재현.
      if (db.coupons.some((c) => c.code === row.code)) {
        return {
          data: [],
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          count: null,
        };
      }
      const created: FakeCouponRow = {
        id: `coupon-${db.coupons.length + 1}`,
        code: row.code as string,
        type: row.type as string,
        value: row.value as number,
        min_subtotal: (row.min_subtotal as number) ?? 0,
        expires_at: (row.expires_at as string | null) ?? null,
        usage_limit: (row.usage_limit as number | null) ?? null,
        used_count: 0,
        is_active: (row.is_active as boolean) ?? true,
        created_at: new Date().toISOString(),
      };
      db.coupons.push(created);
      return { data: [created as unknown as Row], error: null, count: null };
    }
    if (state.op === 'update') {
      const matched = rows.filter(matches);
      for (const r of matched) Object.assign(r, state.patch);
      return { data: matched, error: null, count: null };
    }
    if (state.op === 'delete') {
      const matched = rows.filter(matches);
      if (table === 'coupons') {
        db.coupons = db.coupons.filter((r) => !matched.includes(r as unknown as Row));
      } else {
        db.redemptions = db.redemptions.filter(
          (r) => !matched.includes(r as unknown as Row),
        );
      }
      return { data: matched, error: null, count: null };
    }
    const matched = rows.filter(matches);
    return { data: matched, error: null, count: matched.length };
  }

  const api = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.count) state.countMode = true;
      return api;
    },
    insert(row: Row) {
      state.op = 'insert';
      state.insertRow = row;
      return api;
    },
    update(patch: Row) {
      state.op = 'update';
      state.patch = patch;
      return api;
    },
    delete() {
      state.op = 'delete';
      return api;
    },
    eq(col: string, val: unknown) {
      state.filters.push([col, val]);
      return api;
    },
    order() {
      return api;
    },
    maybeSingle() {
      const { data, error } = exec();
      return Promise.resolve({ data: data[0] ?? null, error });
    },
    single() {
      const { data, error } = exec();
      return Promise.resolve({ data: data[0] ?? null, error });
    },
    // 빌더를 직접 await 하는 경로(insert/delete/count) — thenable.
    then(
      resolve: (v: { data: Row[] | null; error: unknown; count: number | null }) => void,
    ) {
      const { data, error, count } = exec();
      resolve({ data, error, count: state.countMode ? count : null });
    },
  };
  return api;
}

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}));

import {
  consumeCoupon,
  consumeCouponByCode,
  deleteCoupon,
  releaseCoupon,
  releaseCouponByOrder,
  upsertCoupon,
  validateCoupon,
} from '@/lib/db/coupons';

// ---------- fixtures ----------

const USER = asBrand<UserId>('user-1');
const ORDER_NO = asBrand<OrderNo>('20260717-0001');

function seedCoupon(overrides: Partial<FakeCouponRow> = {}): FakeCouponRow {
  const row: FakeCouponRow = {
    id: 'coupon-fixed-1',
    code: 'WELCOME5',
    type: 'fixed',
    value: 5000,
    min_subtotal: 0,
    expires_at: null,
    usage_limit: null,
    used_count: 0,
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  db.coupons.push(row);
  return row;
}

beforeEach(() => {
  db.coupons = [];
  db.redemptions = [];
  vi.restoreAllMocks();
});

// ---------- validateCoupon ----------

describe('validateCoupon — 경계 (ADR-026)', () => {
  it('정상: 대소문자/공백 정규화 후 확정 할인액을 돌려준다 (fixed)', async () => {
    seedCoupon();
    const result = await validateCoupon('  welcome5 ', 30_000, 33_000, USER);
    expect(result).toMatchObject({
      valid: true,
      code: 'WELCOME5',
      type: 'fixed',
      value: 5000,
      discount: 5000,
    });
  });

  it('percent 는 subtotal 기준 bps 계산, 상한은 payable', async () => {
    seedCoupon({ id: 'coupon-pct', code: 'PCT10', type: 'percent', value: 1000 });
    const result = await validateCoupon('PCT10', 30_000, 33_000, null);
    expect(result).toMatchObject({ valid: true, discount: 3000 });
  });

  it('부재 코드와 만료 코드는 같은 COUPON_INVALID 단일 표현 (열거 방지)', async () => {
    seedCoupon({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const missing = await validateCoupon('NO-SUCH', 30_000, 33_000, null);
    const expired = await validateCoupon('WELCOME5', 30_000, 33_000, null);
    expect(missing).toEqual({ valid: false, errorCode: 'COUPON_INVALID' });
    expect(expired).toEqual({ valid: false, errorCode: 'COUPON_INVALID' });
  });

  it('비활성 쿠폰은 COUPON_INVALID', async () => {
    seedCoupon({ is_active: false });
    const result = await validateCoupon('WELCOME5', 30_000, 33_000, null);
    expect(result).toEqual({ valid: false, errorCode: 'COUPON_INVALID' });
  });

  it('min_subtotal 미달은 COUPON_INVALID', async () => {
    seedCoupon({ min_subtotal: 50_000 });
    const result = await validateCoupon('WELCOME5', 30_000, 33_000, USER);
    expect(result).toEqual({ valid: false, errorCode: 'COUPON_INVALID' });
  });

  it('전체 한도 소진은 COUPON_EXHAUSTED', async () => {
    seedCoupon({ usage_limit: 2, used_count: 2 });
    const result = await validateCoupon('WELCOME5', 30_000, 33_000, null);
    expect(result).toEqual({ valid: false, errorCode: 'COUPON_EXHAUSTED' });
  });

  it('회원 기사용은 COUPON_ALREADY_USED (비회원 판정에는 영향 없음)', async () => {
    const coupon = seedCoupon();
    db.redemptions.push({
      id: 'red-1',
      coupon_id: coupon.id,
      user_id: USER as string,
      order_id: null,
    });
    const member = await validateCoupon('WELCOME5', 30_000, 33_000, USER);
    const guest = await validateCoupon('WELCOME5', 30_000, 33_000, null);
    expect(member).toEqual({ valid: false, errorCode: 'COUPON_ALREADY_USED' });
    expect(guest).toMatchObject({ valid: true, discount: 5000 });
  });

  it('할인이 0 으로 계산되면 거부한다 (valid ⇒ discount > 0 계약)', async () => {
    seedCoupon();
    const result = await validateCoupon('WELCOME5', 0, 0, null);
    expect(result).toEqual({ valid: false, errorCode: 'COUPON_INVALID' });
  });
});

// ---------- consumeCoupon ----------

describe('consumeCoupon — 원자 차감 (ADR-026 §4~5)', () => {
  it('정상(회원): used_count +1 + redemptions 원장 기록', async () => {
    const coupon = seedCoupon({ usage_limit: 10 });
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), USER, ORDER_NO);
    expect(result).toEqual({ ok: true });
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toHaveLength(1);
    expect(db.redemptions[0]).toMatchObject({
      coupon_id: coupon.id,
      user_id: USER as string,
    });
  });

  it('정상(비회원): used_count 만 오르고 원장은 기록하지 않는다', async () => {
    const coupon = seedCoupon();
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), null, ORDER_NO);
    expect(result).toEqual({ ok: true });
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toHaveLength(0);
  });

  it('한도 도달(0행 시맨틱)은 COUPON_EXHAUSTED — 카운터/원장 무변화', async () => {
    const coupon = seedCoupon({ usage_limit: 1, used_count: 1 });
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), USER, ORDER_NO);
    expect(result).toMatchObject({ ok: false, errorCode: 'COUPON_EXHAUSTED' });
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toHaveLength(0);
  });

  it('비활성 쿠폰도 소진 거부 (WHERE is_active 시맨틱)', async () => {
    const coupon = seedCoupon({ is_active: false });
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), null, ORDER_NO);
    expect(result).toMatchObject({ ok: false, errorCode: 'COUPON_EXHAUSTED' });
    expect(coupon.used_count).toBe(0);
  });

  it('23505(회원 재사용 경합)는 COUPON_ALREADY_USED + used_count 원복, 경쟁 행은 보존', async () => {
    const coupon = seedCoupon({ used_count: 3 });
    // 경쟁 요청이 먼저 넣은 원장 행 — UNIQUE 충돌을 재현.
    db.redemptions.push({
      id: 'red-race',
      coupon_id: coupon.id,
      user_id: USER as string,
      order_id: null,
    });
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), USER, ORDER_NO);
    expect(result).toMatchObject({ ok: false, errorCode: 'COUPON_ALREADY_USED' });
    // 방금 올린 +1 이 원복돼 3 으로 돌아온다.
    expect(coupon.used_count).toBe(3);
    // 남의(경쟁 요청) 사용 근거는 지우지 않는다.
    expect(db.redemptions).toHaveLength(1);
    expect(db.redemptions[0].id).toBe('red-race');
  });
});

// ---------- releaseCoupon ----------

describe('releaseCoupon — 보상 (never throws)', () => {
  it('회원: 원장 삭제 + used_count 원복', async () => {
    const coupon = seedCoupon({ used_count: 0 });
    await consumeCoupon(asBrand<CouponId>(coupon.id), USER, ORDER_NO);
    expect(coupon.used_count).toBe(1);

    await releaseCoupon(asBrand<CouponId>(coupon.id), USER);
    expect(coupon.used_count).toBe(0);
    expect(db.redemptions).toHaveLength(0);
  });

  it('used_count 0 에서는 바닥 유지 (GREATEST(used_count-1, 0))', async () => {
    const coupon = seedCoupon({ used_count: 0 });
    await releaseCoupon(asBrand<CouponId>(coupon.id), null);
    expect(coupon.used_count).toBe(0);
  });

  it('쿠폰 행 부재에도 던지지 않는다 (구조화 로그만)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      releaseCoupon(asBrand<CouponId>('no-such-coupon'), null),
    ).resolves.toBeUndefined();
    errSpy.mockRestore();
  });
});

// ---------- admin CRUD ----------

describe('admin CRUD — upsert/delete 게이트', () => {
  it('upsertCoupon 은 코드를 대문자 정규화해 저장한다', async () => {
    const { data, error } = await upsertCoupon({
      code: 'summer-10',
      type: 'percent',
      value: 1000,
    });
    expect(error).toBeNull();
    expect(data?.code).toBe('SUMMER-10');
    expect(db.coupons[0].code).toBe('SUMMER-10');
  });

  it('중복 코드는 23505 → 한국어 에러로 매핑', async () => {
    seedCoupon();
    const { data, error } = await upsertCoupon({
      code: 'welcome5',
      type: 'fixed',
      value: 1000,
    });
    expect(data).toBeNull();
    expect(error).toBe('이미 존재하는 쿠폰 코드입니다.');
  });

  it('deleteCoupon 은 사용 이력(used_count > 0)이 있으면 거부한다', async () => {
    const coupon = seedCoupon({ used_count: 1 });
    const { data, error } = await deleteCoupon(asBrand<CouponId>(coupon.id));
    expect(data).toBeNull();
    expect(error).toContain('비활성화');
    expect(db.coupons).toHaveLength(1);
  });

  it('깨끗한 쿠폰은 삭제된다', async () => {
    const coupon = seedCoupon();
    const { data, error } = await deleteCoupon(asBrand<CouponId>(coupon.id));
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(db.coupons).toHaveLength(0);
  });
});

// ---------- 스냅샷 code 경로 (confirm 소비 / cancel 복원) ----------

describe('consumeCouponByCode / releaseCouponByOrder — 스냅샷 code 경로 (FS-X-FIX-A)', () => {
  it('consumeCouponByCode: 정규화된 스냅샷 code 로 id 를 되찾아 원자 소비한다', async () => {
    const coupon = seedCoupon({ usage_limit: 10 });
    const result = await consumeCouponByCode('  welcome5 ', USER, ORDER_NO);
    expect(result).toEqual({ ok: true });
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toHaveLength(1);
  });

  it('consumeCouponByCode: 부재 code 는 COUPON_INVALID (삭제된 쿠폰 등 안전 방향)', async () => {
    const result = await consumeCouponByCode('NO-SUCH', USER, ORDER_NO);
    expect(result).toMatchObject({ ok: false, errorCode: 'COUPON_INVALID' });
  });

  it('releaseCouponByOrder: 스냅샷 code 로 복원 (used_count 원복 + 회원 원장 삭제)', async () => {
    const coupon = seedCoupon({ used_count: 0 });
    await consumeCouponByCode('WELCOME5', USER, ORDER_NO);
    expect(coupon.used_count).toBe(1);

    await releaseCouponByOrder('welcome5', USER);
    expect(coupon.used_count).toBe(0);
    expect(db.redemptions).toHaveLength(0);
  });

  it('releaseCouponByOrder: 부재 code 는 무동작(no-op), 던지지 않는다', async () => {
    await expect(releaseCouponByOrder('NO-SUCH', null)).resolves.toBeUndefined();
  });
});
