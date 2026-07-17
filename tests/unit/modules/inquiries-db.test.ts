/**
 * src/lib/db/inquiries.ts — FS-X-02.
 *
 * service-role 우회 경로이므로 소유권은 코드 레벨 스코핑이 전부다:
 * 목록은 반드시 user_id 필터, 작성은 세션 userId 주입을 검증한다.
 * probe(040 미적용) 시 읽기는 빈 목록, 쓰기는 명시 에러(42P01 비노출).
 * 답변은 admin_reply + status=ANSWERED + answered_at 상태 전이를 검증한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { InquiryId, UserId } from '@/types/common';
import type { InquiryInput } from '@/types/inquiry';

// ---------- Test doubles ----------

type FakeError = { code?: string; message: string } | null;
type QueryResponse = { data: unknown; error: FakeError };

type CallRecord = {
  op: 'select' | 'insert' | 'update';
  table: string;
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
  limit?: number;
};

const state = {
  probe: true,
  selectRows: [] as Array<Record<string, unknown>>,
  selectError: null as FakeError,
  insertError: null as FakeError,
  /** null = UPDATE 매치 0행 (not found). */
  updateRow: null as Record<string, unknown> | null,
  updateError: null as FakeError,
  calls: [] as CallRecord[],
};

type SelectBuilder = PromiseLike<QueryResponse> & {
  eq(col: string, val: unknown): SelectBuilder;
  order(col: string, opts?: { ascending?: boolean }): SelectBuilder;
  limit(n: number): SelectBuilder;
};

function makeSelectBuilder(call: CallRecord): SelectBuilder {
  const builder: SelectBuilder = {
    eq(col, val) {
      call.filters[col] = val;
      return builder;
    },
    order() {
      return builder;
    },
    limit(n) {
      call.limit = n;
      return builder;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve({
        data: state.selectError ? null : state.selectRows,
        error: state.selectError,
      } satisfies QueryResponse).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function makeFrom(table: string) {
  return {
    select() {
      const call: CallRecord = { op: 'select', table, filters: {} };
      state.calls.push(call);
      return makeSelectBuilder(call);
    },
    insert(payload: Record<string, unknown>) {
      const call: CallRecord = { op: 'insert', table, payload, filters: {} };
      state.calls.push(call);
      return {
        select: () => ({
          single: () =>
            Promise.resolve(
              state.insertError
                ? { data: null, error: state.insertError }
                : { data: { ...makeRow(), ...payload }, error: null },
            ),
        }),
      };
    },
    update(patch: Record<string, unknown>) {
      const call: CallRecord = { op: 'update', table, payload: patch, filters: {} };
      state.calls.push(call);
      return {
        eq: (col: string, val: unknown) => {
          call.filters[col] = val;
          return {
            select: () => ({
              maybeSingle: () =>
                Promise.resolve(
                  state.updateError
                    ? { data: null, error: state.updateError }
                    : {
                        data: state.updateRow ? { ...state.updateRow, ...patch } : null,
                        error: null,
                      },
                ),
            }),
          };
        },
      };
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({ from: (table: string) => makeFrom(table) }),
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isInquiriesAvailable: async () => state.probe,
}));

// ---------- Fixtures ----------

const USER_ID = asBrand<UserId>('user-1');
const INQUIRY_ID = asBrand<InquiryId>('inq-1');

function makeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'inq-1',
    user_id: 'user-1',
    order_id: null,
    product_id: null,
    contact_email: 'me@example.com',
    category: '배송',
    subject: '배송 언제 되나요?',
    body: '주문한 액자 배송 일정이 궁금합니다.',
    status: 'OPEN',
    admin_reply: null,
    answered_at: null,
    created_at: '2026-07-17T00:00:00Z',
    ...over,
  };
}

function makeInput(over: Partial<InquiryInput> = {}): InquiryInput {
  return {
    contactEmail: 'me@example.com',
    subject: '배송 언제 되나요?',
    body: '주문한 액자 배송 일정이 궁금합니다.',
    ...over,
  };
}

beforeEach(() => {
  state.probe = true;
  state.selectRows = [];
  state.selectError = null;
  state.insertError = null;
  state.updateRow = null;
  state.updateError = null;
  state.calls = [];
});

// ---------- listMyInquiries ----------

describe('listMyInquiries — 소유권 스코핑 + probe', () => {
  it('user_id 로 스코핑해 조회하고 camelCase 로 매핑한다', async () => {
    const { listMyInquiries } = await import('@/lib/db/inquiries');
    state.selectRows = [makeRow()];

    const { data, error } = await listMyInquiries(USER_ID);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      id: 'inq-1',
      userId: 'user-1',
      contactEmail: 'me@example.com',
      status: 'OPEN',
      adminReply: null,
    });

    // service-role 은 RLS 를 우회하므로 코드 레벨 user_id 필터가 유일한 방어선.
    const call = state.calls.find((c) => c.op === 'select' && c.table === 'inquiries');
    expect(call?.filters['user_id']).toBe('user-1');
  });

  it('probe false(040 미적용)면 쿼리 없이 빈 목록을 반환한다', async () => {
    const { listMyInquiries } = await import('@/lib/db/inquiries');
    state.probe = false;

    expect(await listMyInquiries(USER_ID)).toEqual({ data: [], error: null });
    expect(state.calls).toHaveLength(0);
  });

  it('DB 에러는 값으로 반환한다(throw 금지)', async () => {
    const { listMyInquiries } = await import('@/lib/db/inquiries');
    state.selectError = { message: 'select failed (simulated)' };

    const result = await listMyInquiries(USER_ID);
    expect(result.data).toBeNull();
    expect(result.error).toContain('select failed');
  });
});

// ---------- createInquiry ----------

describe('createInquiry — 세션 userId 주입 + probe', () => {
  it('user_id 는 입력이 아니라 인자(세션)에서 주입된다', async () => {
    const { createInquiry } = await import('@/lib/db/inquiries');

    const { data, error } = await createInquiry(USER_ID, makeInput());
    expect(error).toBeNull();
    expect(data?.userId).toBe('user-1');

    const call = state.calls.find((c) => c.op === 'insert');
    expect(call?.payload).toMatchObject({
      user_id: 'user-1',
      contact_email: 'me@example.com',
      subject: '배송 언제 되나요?',
    });
    // 상태/답변 컬럼은 삽입하지 않는다 — DB DEFAULT(OPEN)와 admin 경로 전용.
    expect(call?.payload).not.toHaveProperty('status');
    expect(call?.payload).not.toHaveProperty('admin_reply');
  });

  it('probe false 면 INSERT 없이 명시 에러를 반환한다', async () => {
    const { createInquiry, INQUIRIES_UNAVAILABLE } = await import('@/lib/db/inquiries');
    state.probe = false;

    const result = await createInquiry(USER_ID, makeInput());
    expect(result.data).toBeNull();
    expect(result.error).toBe(INQUIRIES_UNAVAILABLE);
    expect(state.calls).toHaveLength(0);
  });

  it('FK 위반(23503)은 REF_NOT_FOUND 로 구분한다 — 라우트 422 매핑용', async () => {
    const { createInquiry } = await import('@/lib/db/inquiries');
    state.insertError = { code: '23503', message: 'violates foreign key constraint' };

    const result = await createInquiry(
      USER_ID,
      makeInput({ orderId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(result.error).toBe('REF_NOT_FOUND');
  });
});

// ---------- getAllInquiries ----------

describe('getAllInquiries — 관리자 목록', () => {
  it('statusFilter 를 주면 status eq 필터가 걸린다', async () => {
    const { getAllInquiries } = await import('@/lib/db/inquiries');
    state.selectRows = [makeRow({ status: 'OPEN' })];

    const { error } = await getAllInquiries(20, 'OPEN');
    expect(error).toBeNull();

    const call = state.calls.find((c) => c.op === 'select');
    expect(call?.filters['status']).toBe('OPEN');
    expect(call?.limit).toBe(20);
  });

  it('필터 없이는 status 조건 없이 전체 최신순으로 조회한다', async () => {
    const { getAllInquiries } = await import('@/lib/db/inquiries');
    state.selectRows = [makeRow()];

    await getAllInquiries();
    const call = state.calls.find((c) => c.op === 'select');
    expect(call?.filters).not.toHaveProperty('status');
    expect(call?.limit).toBe(50);
  });

  it('probe false 면 빈 목록(관리자 페이지 그레이스풀)', async () => {
    const { getAllInquiries } = await import('@/lib/db/inquiries');
    state.probe = false;
    expect(await getAllInquiries()).toEqual({ data: [], error: null });
  });
});

// ---------- replyToInquiry ----------

describe('replyToInquiry — 상태 전이 OPEN → ANSWERED', () => {
  it('admin_reply + status=ANSWERED + answered_at 을 한 UPDATE 로 기록한다', async () => {
    const { replyToInquiry } = await import('@/lib/db/inquiries');
    state.updateRow = makeRow();

    const { data, error } = await replyToInquiry(INQUIRY_ID, '내일 출고 예정입니다.');
    expect(error).toBeNull();
    expect(data?.status).toBe('ANSWERED');
    expect(data?.adminReply).toBe('내일 출고 예정입니다.');
    expect(data?.answeredAt).not.toBeNull();

    const call = state.calls.find((c) => c.op === 'update');
    expect(call?.filters['id']).toBe('inq-1');
    expect(call?.payload).toMatchObject({
      admin_reply: '내일 출고 예정입니다.',
      status: 'ANSWERED',
    });
    expect(typeof call?.payload?.['answered_at']).toBe('string');
  });

  it('대상 문의가 없으면 not found 에러 값을 반환한다', async () => {
    const { replyToInquiry } = await import('@/lib/db/inquiries');
    state.updateRow = null;

    const result = await replyToInquiry(INQUIRY_ID, '답변');
    expect(result.data).toBeNull();
    expect(result.error).toContain('not found');
  });

  it('probe false 면 UPDATE 없이 명시 에러를 반환한다', async () => {
    const { replyToInquiry, INQUIRIES_UNAVAILABLE } = await import('@/lib/db/inquiries');
    state.probe = false;

    const result = await replyToInquiry(INQUIRY_ID, '답변');
    expect(result.error).toBe(INQUIRIES_UNAVAILABLE);
    expect(state.calls).toHaveLength(0);
  });
});
