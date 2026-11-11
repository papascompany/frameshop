/**
 * lib/db/coupons — 쿠폰 데이터 접근 금전 경로 테스트 (FS-X-01, ADR-026 + 보안 검토 P1-3).
 *
 * 핵심 계약: validate 경계(만료/최소금액/한도/재사용/부재 단일 표현 + 결제완료 계열
 * 주문 거부), consume 원자성(0행 = 소진 거부, 23505 = 회원 재사용 + used_count 원복,
 * 주문 연결·주문 단위 멱등), 주문 단위 복원(그 주문이 소비했을 때만 — 남의 기록 보존),
 * 승인 직전 확인(checkCouponPayable), admin delete 게이트. 인메모리 페이크가
 * UNIQUE(coupon_id, user_id)·045 UNIQUE(order_id)·CAS(WHERE used_count = 읽은 값)
 * 시맨틱을 재현하고, 045 미적용이면 order_no 컬럼 부재(42703)·user_id NOT NULL(23502)을
 * 재현해 conditional-spread 를 검증한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { CouponId, OrderId, OrderNo, UserId } from '@/types/common';

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
  user_id: string | null;
  order_id: string | null;
  order_no?: string | null;
};

type FakeOrderRow = {
  id: string;
  order_no: string;
  user_id: string | null;
  coupon_code: string | null;
  status: string;
};

const db: {
  coupons: FakeCouponRow[];
  redemptions: FakeRedemptionRow[];
  orders: FakeOrderRow[];
} = { coupons: [], redemptions: [], orders: [] };

/** 045 적용 여부 — probe 와 페이크 스키마(order_no 컬럼·user_id NULL·UNIQUE(order_id))를 함께 바꾼다. */
const schema = { ledger: false };
/** `${table}:${op}` — 해당 연산이 DB 오류를 돌려주게 한다. */
const failOps = new Set<string>();

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };

function tableRows(table: string): Row[] {
  if (table === 'coupons') return db.coupons as unknown as Row[];
  if (table === 'coupon_redemptions') return db.redemptions as unknown as Row[];
  if (table === 'orders') return db.orders as unknown as Row[];
  throw new Error(`Unmocked table: ${table}`);
}

function setTableRows(table: string, rows: Row[]): void {
  if (table === 'coupons') db.coupons = rows as unknown as FakeCouponRow[];
  else if (table === 'coupon_redemptions') {
    db.redemptions = rows as unknown as FakeRedemptionRow[];
  } else db.orders = rows as unknown as FakeOrderRow[];
}

const DUP: DbError = {
  code: '23505',
  message: 'duplicate key value violates unique constraint',
};

function insertRedemption(row: Row): { data: Row[]; error: DbError | null } {
  if (!schema.ledger && 'order_no' in row) {
    return {
      data: [],
      error: { code: '42703', message: 'column "order_no" does not exist' },
    };
  }
  if (!schema.ledger && row.user_id == null) {
    return {
      data: [],
      error: { code: '23502', message: 'null value in column "user_id"' },
    };
  }
  const userId = (row.user_id as string | null) ?? null;
  const orderId = (row.order_id as string | null) ?? null;
  if (
    userId != null &&
    db.redemptions.some((r) => r.coupon_id === row.coupon_id && r.user_id === userId)
  ) {
    return { data: [], error: DUP };
  }
  if (
    schema.ledger &&
    orderId != null &&
    db.redemptions.some((r) => r.order_id === orderId)
  ) {
    return { data: [], error: DUP };
  }
  const created: FakeRedemptionRow = {
    id: `red-${db.redemptions.length + 1}`,
    coupon_id: row.coupon_id as string,
    user_id: userId,
    order_id: orderId,
    ...('order_no' in row ? { order_no: row.order_no as string } : {}),
  };
  db.redemptions.push(created);
  return { data: [created as unknown as Row], error: null };
}

function insertCoupon(row: Row): { data: Row[]; error: DbError | null } {
  if (db.coupons.some((c) => c.code === row.code)) return { data: [], error: DUP };
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
  return { data: [created as unknown as Row], error: null };
}

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'in'; col: string; vals: unknown[] }
  | { kind: 'is'; col: string; val: null };

/**
 * 최소 PostgREST 빌더 페이크 — 필터 누적 후 maybeSingle/await 시점에 실행.
 * update 는 필터 매칭 행에만 patch 를 적용(0행 = CAS 실패 재현), delete 는 지운 행을
 * 돌려준다(.delete().eq().select() 시맨틱).
 */
function makeBuilder(table: string) {
  type Op = 'select' | 'update' | 'insert' | 'delete';
  const state: {
    op: Op;
    patch: Row | null;
    insertRow: Row | null;
    filters: Filter[];
    countMode: boolean;
  } = { op: 'select', patch: null, insertRow: null, filters: [], countMode: false };

  const matches = (r: Row): boolean =>
    state.filters.every((f) => {
      const v = r[f.col] ?? null;
      if (f.kind === 'eq') return v === f.val;
      if (f.kind === 'in') return f.vals.includes(v);
      return v === null;
    });

  function exec(): { data: Row[]; error: DbError | null; count: number | null } {
    if (failOps.has(`${table}:${state.op}`)) {
      return { data: [], error: { message: `${table} ${state.op} failed (simulated)` }, count: null };
    }
    const rows = tableRows(table);
    if (state.op === 'insert') {
      const row = state.insertRow as Row;
      const result =
        table === 'coupon_redemptions' ? insertRedemption(row) : insertCoupon(row);
      return { ...result, count: null };
    }
    const matched = rows.filter(matches);
    if (state.op === 'update') {
      for (const r of matched) Object.assign(r, state.patch);
      return { data: matched, error: null, count: null };
    }
    if (state.op === 'delete') {
      setTableRows(
        table,
        rows.filter((r) => !matched.includes(r)),
      );
      return { data: matched, error: null, count: null };
    }
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
      state.filters.push({ kind: 'eq', col, val });
      return api;
    },
    in(col: string, vals: unknown[]) {
      state.filters.push({ kind: 'in', col, vals });
      return api;
    },
    is(col: string, val: null) {
      state.filters.push({ kind: 'is', col, val });
      return api;
    },
    order() {
      return api;
    },
    limit() {
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
    // 빌더를 직접 await 하는 경로(insert/delete/count/list) — thenable.
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

vi.mock('@/lib/db/feature-probe', () => ({
  isCouponOrderLedgerAvailable: async () => schema.ledger,
}));

import {
  checkCouponPayable,
  consumeCoupon,
  consumeCouponByCode,
  deleteCoupon,
  releaseCouponByOrder,
  upsertCoupon,
  validateCoupon,
} from '@/lib/db/coupons';

// ---------- fixtures ----------

const USER = asBrand<UserId>('user-1');
const OTHER_USER = asBrand<UserId>('user-2');
const ORDER_NO = asBrand<OrderNo>('20260717-0001');
const ORDER_A = asBrand<OrderId>('order-a');
const ORDER_B = asBrand<OrderId>('order-b');
const ORDER_NO_A = asBrand<OrderNo>('20261112-0001');
const ORDER_NO_B = asBrand<OrderNo>('20261112-0002');

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

function seedOrder(overrides: Partial<FakeOrderRow> = {}): FakeOrderRow {
  const row: FakeOrderRow = {
    id: ORDER_A as string,
    order_no: ORDER_NO_A as string,
    user_id: USER as string,
    coupon_code: 'WELCOME5',
    status: 'CREATED',
    ...overrides,
  };
  db.orders.push(row);
  return row;
}

beforeEach(() => {
  db.coupons = [];
  db.redemptions = [];
  db.orders = [];
  schema.ledger = false;
  failOps.clear();
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

describe('validateCoupon — 진행 중 주문 점유 (보안 검토 P1-3)', () => {
  it('이 쿠폰을 단 결제완료 계열 주문이 있으면 소비 기록이 없어도 COUPON_ALREADY_USED', async () => {
    // 소비 실패(fail-open)로 원장에 남지 않은 PAID 주문 — 042 판정은 이걸 놓쳤다.
    seedCoupon();
    seedOrder({ status: 'PAID' });
    const result = await validateCoupon('WELCOME5', 30_000, 33_000, USER);
    expect(result).toEqual({ valid: false, errorCode: 'COUPON_ALREADY_USED' });
  });

  it.each(['IN_PRODUCTION', 'SHIPPED', 'DELIVERED'])(
    '%s 주문도 점유로 본다',
    async (status) => {
      seedCoupon();
      seedOrder({ status });
      const result = await validateCoupon('WELCOME5', 30_000, 33_000, USER);
      expect(result).toEqual({ valid: false, errorCode: 'COUPON_ALREADY_USED' });
    },
  );

  it('미결제(CREATED) 주문만 있으면 통과 — 재결제 흐름은 createOrder 가 대체로 처리한다', async () => {
    seedCoupon();
    seedOrder({ status: 'CREATED' });
    const result = await validateCoupon('WELCOME5', 30_000, 33_000, USER);
    expect(result).toMatchObject({ valid: true, discount: 5000 });
  });

  it('취소·환불된 주문과 다른 회원의 주문은 점유하지 않는다', async () => {
    seedCoupon();
    seedOrder({ id: 'o-1', order_no: '20261112-0011', status: 'CANCELLED' });
    seedOrder({ id: 'o-2', order_no: '20261112-0012', status: 'REFUNDED' });
    seedOrder({
      id: 'o-3',
      order_no: '20261112-0013',
      user_id: OTHER_USER as string,
      status: 'PAID',
    });
    const result = await validateCoupon('WELCOME5', 30_000, 33_000, USER);
    expect(result).toMatchObject({ valid: true });
  });

  it('진행 중 주문 조회 오류는 fail-closed(COUPON_INVALID)', async () => {
    seedCoupon();
    failOps.add('orders:select');
    const result = await validateCoupon('WELCOME5', 30_000, 33_000, USER);
    expect(result).toEqual({ valid: false, errorCode: 'COUPON_INVALID' });
  });
});

// ---------- consumeCoupon ----------

describe('consumeCoupon — 원자 차감 (ADR-026 §4~5)', () => {
  it('정상(회원): used_count +1 + 원장에 주문(order_id) 기록 — 045 미적용이면 order_no 생략', async () => {
    const coupon = seedCoupon({ usage_limit: 10 });
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), USER, ORDER_NO, ORDER_A);
    expect(result).toEqual({ ok: true });
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toEqual([
      { id: 'red-1', coupon_id: coupon.id, user_id: USER as string, order_id: ORDER_A },
    ]);
  });

  it('정상(비회원, 045 미적용): used_count 만 오르고 원장은 기록하지 않는다', async () => {
    const coupon = seedCoupon();
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), null, ORDER_NO, ORDER_A);
    expect(result).toEqual({ ok: true });
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toHaveLength(0);
  });

  it('045 적용: 회원·비회원 모두 order_id + order_no 로 기록한다', async () => {
    schema.ledger = true;
    const coupon = seedCoupon();
    await consumeCoupon(asBrand<CouponId>(coupon.id), USER, ORDER_NO_A, ORDER_A);
    await consumeCoupon(asBrand<CouponId>(coupon.id), null, ORDER_NO_B, ORDER_B);
    expect(coupon.used_count).toBe(2);
    expect(db.redemptions).toEqual([
      expect.objectContaining({ user_id: USER as string, order_id: ORDER_A, order_no: ORDER_NO_A }),
      expect.objectContaining({ user_id: null, order_id: ORDER_B, order_no: ORDER_NO_B }),
    ]);
  });

  it('같은 주문의 재소비는 멱등 — 추가 차감·원장 없음', async () => {
    schema.ledger = true;
    const coupon = seedCoupon();
    await consumeCoupon(asBrand<CouponId>(coupon.id), null, ORDER_NO_A, ORDER_A);
    const again = await consumeCoupon(asBrand<CouponId>(coupon.id), null, ORDER_NO_A, ORDER_A);
    expect(again).toEqual({ ok: true });
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toHaveLength(1);
  });

  it('한도 도달(0행 시맨틱)은 COUPON_EXHAUSTED — 카운터/원장 무변화', async () => {
    const coupon = seedCoupon({ usage_limit: 1, used_count: 1 });
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), USER, ORDER_NO, ORDER_A);
    expect(result).toMatchObject({ ok: false, errorCode: 'COUPON_EXHAUSTED' });
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toHaveLength(0);
  });

  it('비활성 쿠폰도 소진 거부 (WHERE is_active 시맨틱)', async () => {
    const coupon = seedCoupon({ is_active: false });
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), null, ORDER_NO, ORDER_A);
    expect(result).toMatchObject({ ok: false, errorCode: 'COUPON_EXHAUSTED' });
    expect(coupon.used_count).toBe(0);
  });

  it('23505(회원 재사용 경합)는 COUPON_ALREADY_USED + used_count 원복, 경쟁 행은 보존', async () => {
    const coupon = seedCoupon({ used_count: 3 });
    // 다른 주문이 먼저 넣은 원장 행 — UNIQUE(coupon_id, user_id) 충돌을 재현.
    db.redemptions.push({
      id: 'red-race',
      coupon_id: coupon.id,
      user_id: USER as string,
      order_id: ORDER_B,
    });
    const result = await consumeCoupon(asBrand<CouponId>(coupon.id), USER, ORDER_NO, ORDER_A);
    expect(result).toMatchObject({ ok: false, errorCode: 'COUPON_ALREADY_USED' });
    // 방금 올린 +1 이 원복돼 3 으로 돌아온다.
    expect(coupon.used_count).toBe(3);
    // 남의(경쟁 요청) 사용 근거는 지우지 않는다.
    expect(db.redemptions).toEqual([expect.objectContaining({ id: 'red-race', order_id: ORDER_B })]);
  });
});

// ---------- releaseCouponByOrder (주문 단위 복원) ----------

describe('releaseCouponByOrder — 그 주문이 소비했을 때만 복원 (보안 검토 P1-3)', () => {
  it('취소 시 남의 redemption 보존: 소비에 실패한 주문 B 를 취소해도 주문 A 의 기록·카운터는 그대로', async () => {
    // 재현: 같은 회원·같은 쿠폰의 주문 A(소비 성공)와 B(소비 23505 실패, fail-open PAID).
    const coupon = seedCoupon({ used_count: 0 });
    seedOrder({ id: ORDER_A as string, order_no: ORDER_NO_A as string, status: 'CREATED' });
    seedOrder({ id: ORDER_B as string, order_no: ORDER_NO_B as string, status: 'CREATED' });
    expect(
      await consumeCouponByCode('WELCOME5', USER, ORDER_NO_A, ORDER_A),
    ).toEqual({ ok: true });
    db.orders[0].status = 'PAID';
    expect(
      await consumeCouponByCode('WELCOME5', USER, ORDER_NO_B, ORDER_B),
    ).toMatchObject({ ok: false, errorCode: 'COUPON_ALREADY_USED' });
    db.orders[1].status = 'CANCELLED'; // B 취소 전이 성공 후 복원 호출.

    await releaseCouponByOrder('WELCOME5', USER, ORDER_B);

    // 042 동작이었다면 coupon_id + user_id 로 A 의 행이 지워지고 used_count 0 → 재사용 가능.
    expect(db.redemptions).toEqual([
      expect.objectContaining({ user_id: USER as string, order_id: ORDER_A }),
    ]);
    expect(coupon.used_count).toBe(1);
    expect(await validateCoupon('WELCOME5', 30_000, 33_000, USER)).toEqual({
      valid: false,
      errorCode: 'COUPON_ALREADY_USED',
    });
  });

  it('그 주문이 소비했으면 그 행만 지우고 used_count −1 (스냅샷 code 정규화)', async () => {
    const coupon = seedCoupon({ used_count: 0 });
    await consumeCouponByCode('WELCOME5', USER, ORDER_NO_A, ORDER_A);
    db.redemptions.push({
      id: 'red-other-user',
      coupon_id: coupon.id,
      user_id: OTHER_USER as string,
      order_id: 'order-z',
    });
    coupon.used_count = 2;

    await releaseCouponByOrder('welcome5', USER, ORDER_A);

    expect(coupon.used_count).toBe(1);
    expect(db.redemptions.map((r) => r.id)).toEqual(['red-other-user']);
  });

  it('레거시(주문 미연결) 행은 이 회원의 다른 진행 중 주문이 없을 때만 이 주문 것으로 보고 복원', async () => {
    const coupon = seedCoupon({ used_count: 1 });
    db.redemptions.push({ id: 'red-legacy', coupon_id: coupon.id, user_id: USER as string, order_id: null });
    seedOrder({ id: ORDER_A as string, status: 'CANCELLED' });

    await releaseCouponByOrder('WELCOME5', USER, ORDER_A);

    expect(db.redemptions).toHaveLength(0);
    expect(coupon.used_count).toBe(0);
  });

  it('레거시 행인데 다른 진행 중 주문이 있으면 판정 불가 — 보존(묶인 채 남는 안전 방향)', async () => {
    const coupon = seedCoupon({ used_count: 1 });
    db.redemptions.push({ id: 'red-legacy', coupon_id: coupon.id, user_id: USER as string, order_id: null });
    seedOrder({ id: ORDER_A as string, order_no: ORDER_NO_A as string, status: 'PAID' });
    seedOrder({ id: ORDER_B as string, order_no: ORDER_NO_B as string, status: 'CANCELLED' });

    await releaseCouponByOrder('WELCOME5', USER, ORDER_B);

    expect(db.redemptions.map((r) => r.id)).toEqual(['red-legacy']);
    expect(coupon.used_count).toBe(1);
  });

  it('비회원 + 045: 이 주문의 소비 기록이 없으면 무동작(카운터 유지)', async () => {
    schema.ledger = true;
    const coupon = seedCoupon({ used_count: 3 });
    await releaseCouponByOrder('WELCOME5', null, ORDER_B);
    expect(coupon.used_count).toBe(3);
  });

  it('비회원 + 045: 이 주문이 소비했으면 그 행 삭제 + −1', async () => {
    schema.ledger = true;
    const coupon = seedCoupon({ used_count: 0 });
    await consumeCouponByCode('WELCOME5', null, ORDER_NO_A, ORDER_A);
    await consumeCouponByCode('WELCOME5', null, ORDER_NO_B, ORDER_B);
    expect(coupon.used_count).toBe(2);

    await releaseCouponByOrder('WELCOME5', null, ORDER_A);

    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toEqual([expect.objectContaining({ order_id: ORDER_B })]);
  });

  it('비회원 + 045 미적용: 소비 기록이 없어 판정 불가 — 기존 동작(−1) 유지', async () => {
    const coupon = seedCoupon({ used_count: 2 });
    await releaseCouponByOrder('WELCOME5', null, ORDER_A);
    expect(coupon.used_count).toBe(1);
  });

  it('used_count 0 에서는 바닥 유지 (GREATEST(used_count-1, 0))', async () => {
    const coupon = seedCoupon({ used_count: 0 });
    await releaseCouponByOrder('WELCOME5', null, ORDER_A);
    expect(coupon.used_count).toBe(0);
  });

  it('부재 code 는 무동작(no-op), 던지지 않는다', async () => {
    await expect(releaseCouponByOrder('NO-SUCH', null, ORDER_A)).resolves.toBeUndefined();
  });

  it('원장 삭제 오류에도 던지지 않고 카운터를 건드리지 않는다', async () => {
    const coupon = seedCoupon({ used_count: 1 });
    db.redemptions.push({ id: 'red-a', coupon_id: coupon.id, user_id: USER as string, order_id: ORDER_A });
    failOps.add('coupon_redemptions:delete');
    await expect(releaseCouponByOrder('WELCOME5', USER, ORDER_A)).resolves.toBeUndefined();
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toHaveLength(1);
  });
});

// ---------- checkCouponPayable (승인 직전 확인) ----------

describe('checkCouponPayable — Toss 승인 직전 확인 (보안 검토 P1-3)', () => {
  it('병렬 주문 2건(회원): A 결제·소비 후 B 는 승인 직전에 COUPON_ALREADY_USED', async () => {
    seedCoupon();
    seedOrder({ id: ORDER_A as string, order_no: ORDER_NO_A as string, status: 'CREATED' });
    seedOrder({ id: ORDER_B as string, order_no: ORDER_NO_B as string, status: 'CREATED' });

    expect(await checkCouponPayable('WELCOME5', USER, ORDER_A)).toEqual({ ok: true });
    await consumeCouponByCode('WELCOME5', USER, ORDER_NO_A, ORDER_A);
    db.orders[0].status = 'PAID';

    expect(await checkCouponPayable('WELCOME5', USER, ORDER_B)).toEqual({
      ok: false,
      errorCode: 'COUPON_ALREADY_USED',
    });
  });

  it('이 주문이 이미 소비했으면 통과(멱등 재확정)', async () => {
    const coupon = seedCoupon({ usage_limit: 1, used_count: 1 });
    db.redemptions.push({ id: 'red-a', coupon_id: coupon.id, user_id: USER as string, order_id: ORDER_A });
    expect(await checkCouponPayable('WELCOME5', USER, ORDER_A)).toEqual({ ok: true });
  });

  it('소비 기록 없이 결제완료된 다른 주문이 쿠폰을 점유하면 COUPON_ALREADY_USED', async () => {
    seedCoupon();
    seedOrder({ id: ORDER_A as string, order_no: ORDER_NO_A as string, status: 'PAID' });
    seedOrder({ id: ORDER_B as string, order_no: ORDER_NO_B as string, status: 'CREATED' });
    expect(await checkCouponPayable('WELCOME5', USER, ORDER_B)).toEqual({
      ok: false,
      errorCode: 'COUPON_ALREADY_USED',
    });
  });

  it('병렬 주문 2건(비회원, 한도 1): A 소비 후 B 는 COUPON_EXHAUSTED', async () => {
    seedCoupon({ usage_limit: 1 });
    expect(await checkCouponPayable('WELCOME5', null, ORDER_A)).toEqual({ ok: true });
    await consumeCouponByCode('WELCOME5', null, ORDER_NO_A, ORDER_A);
    expect(await checkCouponPayable('WELCOME5', null, ORDER_B)).toEqual({
      ok: false,
      errorCode: 'COUPON_EXHAUSTED',
    });
  });

  it('부재·비활성 쿠폰은 거부하지 않는다(사후 정책 변경으로 결제를 막지 않음)', async () => {
    seedCoupon({ is_active: false });
    expect(await checkCouponPayable('WELCOME5', USER, ORDER_A)).toEqual({ ok: true });
    expect(await checkCouponPayable('NO-SUCH', USER, ORDER_A)).toEqual({ ok: true });
  });

  it('DB 오류는 통과(fail-open) — 일시 오류로 정상 결제를 막지 않는다', async () => {
    seedCoupon({ usage_limit: 1, used_count: 1 });
    failOps.add('coupons:select');
    expect(await checkCouponPayable('WELCOME5', null, ORDER_A)).toEqual({ ok: true });
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

// ---------- 스냅샷 code 경로 (confirm 소비) ----------

describe('consumeCouponByCode — 스냅샷 code 경로 (FS-X-FIX-A)', () => {
  it('정규화된 스냅샷 code 로 id 를 되찾아 원자 소비한다', async () => {
    const coupon = seedCoupon({ usage_limit: 10 });
    const result = await consumeCouponByCode('  welcome5 ', USER, ORDER_NO, ORDER_A);
    expect(result).toEqual({ ok: true });
    expect(coupon.used_count).toBe(1);
    expect(db.redemptions).toHaveLength(1);
  });

  it('부재 code 는 COUPON_INVALID (삭제된 쿠폰 등 안전 방향)', async () => {
    const result = await consumeCouponByCode('NO-SUCH', USER, ORDER_NO, ORDER_A);
    expect(result).toMatchObject({ ok: false, errorCode: 'COUPON_INVALID' });
  });
});
