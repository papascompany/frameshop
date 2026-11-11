/**
 * listStaleCreatedOrders 키셋 페이지네이션 쿼리 (보안 검토 P1-8).
 *
 * 스윕 테스트는 이 함수를 mock 하므로, 실제 PostgREST 빌더 호출(필터·커서 OR 식·
 * 정렬·limit)을 여기서 따로 고정한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { OrderId } from '@/types/common';

type Call = [method: string, ...args: unknown[]];

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      h.calls.push(['from', table]);
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'lt', 'or', 'order']) {
        builder[m] = (...args: unknown[]) => {
          h.calls.push([m, ...args]);
          return builder;
        };
      }
      builder.limit = (n: number) => {
        h.calls.push(['limit', n]);
        return Promise.resolve({ data: h.rows, error: null });
      };
      return builder;
    },
  }),
}));

import { listStaleCreatedOrders } from '@/lib/db/order';

const CUTOFF = new Date('2026-11-11T08:45:00.000Z');

beforeEach(() => {
  h.calls.length = 0;
  h.rows = [];
});

describe('listStaleCreatedOrders', () => {
  it('첫 페이지: CREATED + cutoff 이전, 최신 순(created_at DESC, id DESC), 커서 조건 없음', async () => {
    await listStaleCreatedOrders(CUTOFF, 20);

    expect(h.calls as Call[]).toEqual([
      ['from', 'orders'],
      ['select', 'id, order_no, total_price, created_at'],
      ['eq', 'status', 'CREATED'],
      ['lt', 'created_at', CUTOFF.toISOString()],
      ['order', 'created_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', 20],
    ]);
  });

  it('다음 페이지: (created_at, id) < 커서 를 따옴표로 감싼 OR 식으로 건다', async () => {
    await listStaleCreatedOrders(CUTOFF, 20, {
      createdAt: '2026-11-10T03:12:45.123456+00:00',
      id: asBrand<OrderId>('5b0c6f1e-0000-4000-8000-000000000001'),
    });

    const orCall = (h.calls as Call[]).find((c) => c[0] === 'or');
    expect(orCall).toEqual([
      'or',
      'created_at.lt."2026-11-10T03:12:45.123456+00:00",' +
        'and(created_at.eq."2026-11-10T03:12:45.123456+00:00",id.lt."5b0c6f1e-0000-4000-8000-000000000001")',
    ]);
    // 커서 조건은 정렬·limit 전에 붙는다.
    const methods = (h.calls as Call[]).map((c) => c[0]);
    expect(methods.indexOf('or')).toBeLessThan(methods.indexOf('order'));
  });

  it('행을 StaleCreatedOrder 로 매핑한다', async () => {
    h.rows = [
      { id: 'o-1', order_no: '20261110-0001', total_price: 16800, created_at: '2026-11-10T03:12:45+00:00' },
    ];
    const page = await listStaleCreatedOrders(CUTOFF, 20);
    expect(page).toEqual([
      { id: 'o-1', orderNo: '20261110-0001', totalPrice: 16800, createdAt: '2026-11-10T03:12:45+00:00' },
    ]);
  });
});
