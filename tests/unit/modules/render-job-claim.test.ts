/**
 * src/lib/render/jobs.ts — claimRenderJob 선점 CAS.
 *
 * 고정하는 계약:
 *  1. UPDATE 는 읽은 status·attempts 가 그대로일 때만 매칭된다(.eq 조건 3개).
 *  2. 매칭 행이 정확히 1개일 때만 true — 경합에서 진 쪽(0행)은 false.
 *  3. 종결(DONE)·시도 소진·행 없음·DB 오류는 false.
 *  4. 두 선점자가 같은 행을 동시에 잡으면 하나만 이긴다(인메모리 행으로 재현).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { OrderItemId } from '@/types/common';

type Row = { id: string; order_item_id: string; status: string; attempts: number };
type FakeError = { message: string } | null;

const state = {
  row: null as Row | null,
  updateError: null as FakeError,
  updateFilters: [] as Array<Record<string, unknown>>,
  /** 읽기와 쓰기 사이에 끼어드는 다른 선점자를 흉내 낸다. */
  beforeUpdate: null as null | (() => void),
};

function makeClient() {
  return {
    from(table: string) {
      if (table !== 'print_render_jobs') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return builder;
            },
            async maybeSingle() {
              const row = state.row;
              if (!row || row.order_item_id !== filters['order_item_id']) {
                return { data: null, error: null };
              }
              return { data: { id: row.id, status: row.status, attempts: row.attempts }, error: null };
            },
          };
          return builder;
        },
        update(patch: { status: string; attempts: number }) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return builder;
            },
            async select() {
              state.updateFilters.push({ ...filters });
              if (state.updateError) return { data: null, error: state.updateError };
              state.beforeUpdate?.();
              const row = state.row;
              const matches =
                row !== null &&
                row.id === filters['id'] &&
                (!('status' in filters) || row.status === filters['status']) &&
                (!('attempts' in filters) || row.attempts === filters['attempts']);
              if (!matches || row === null) return { data: [], error: null };
              row.status = patch.status;
              row.attempts = patch.attempts;
              return { data: [{ id: row.id }], error: null };
            },
          };
          return builder;
        },
      };
    },
  };
}

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => makeClient(),
}));

import { claimRenderJob, MAX_ATTEMPTS } from '@/lib/render/jobs';

const ITEM = asBrand<OrderItemId>('item-1');

beforeEach(() => {
  state.row = { id: 'job-1', order_item_id: 'item-1', status: 'PENDING', attempts: 0 };
  state.updateError = null;
  state.updateFilters = [];
  state.beforeUpdate = null;
});

describe('claimRenderJob — CAS', () => {
  it('PENDING 행을 RUNNING 으로 선점하고 읽은 status·attempts 를 조건으로 건다', async () => {
    await expect(claimRenderJob(ITEM)).resolves.toBe(true);
    expect(state.row).toMatchObject({ status: 'RUNNING', attempts: 1 });
    expect(state.updateFilters).toEqual([{ id: 'job-1', status: 'PENDING', attempts: 0 }]);
  });

  it('읽은 뒤 다른 선점자가 먼저 바꾸면 false (0행 매칭)', async () => {
    state.beforeUpdate = () => {
      if (state.row) {
        state.row.status = 'RUNNING';
        state.row.attempts = 1;
      }
    };
    await expect(claimRenderJob(ITEM)).resolves.toBe(false);
    expect(state.row).toMatchObject({ status: 'RUNNING', attempts: 1 });
  });

  it('동시에 두 번 선점하면 하나만 이긴다', async () => {
    const results = await Promise.all([claimRenderJob(ITEM), claimRenderJob(ITEM)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(state.row).toMatchObject({ status: 'RUNNING', attempts: 1 });
  });

  it('DONE(종결)은 선점하지 않는다', async () => {
    state.row = { id: 'job-1', order_item_id: 'item-1', status: 'DONE', attempts: 1 };
    await expect(claimRenderJob(ITEM)).resolves.toBe(false);
    expect(state.updateFilters).toHaveLength(0);
  });

  it('시도 소진(attempts >= MAX_ATTEMPTS)은 선점하지 않는다', async () => {
    state.row = { id: 'job-1', order_item_id: 'item-1', status: 'FAILED', attempts: MAX_ATTEMPTS };
    await expect(claimRenderJob(ITEM)).resolves.toBe(false);
    expect(state.updateFilters).toHaveLength(0);
  });

  it('행이 없으면 false', async () => {
    state.row = null;
    await expect(claimRenderJob(ITEM)).resolves.toBe(false);
  });

  it('UPDATE 오류는 false', async () => {
    state.updateError = { message: 'boom' };
    await expect(claimRenderJob(ITEM)).resolves.toBe(false);
  });
});
