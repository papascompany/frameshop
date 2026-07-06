/**
 * cart DB 계층 — FS-P1-02 확장형 묶음 probe 폴백 (ADR-025).
 *
 * Covers: upsertCartProject dedup((user_id, project_local_id))·23505 race 수습,
 * upsertCartItem 의 FK 순서(헤더 upsert → 자식 upsert)와 probe true 시 project
 * 컬럼 포함, probe false 시 현행 평면 payload(문자 그대로 — sync 폴백 드롭),
 * listCartForUser 의 probe 별 SELECT 문자열 분기와 매핑.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/types/cart';
import { asBrand } from '@/types/common';
import type {
  CartProjectId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  ProjectLocalId,
  UserId,
} from '@/types/common';

// ---------- Test doubles ----------

type HeaderRow = {
  id: string;
  project_local_id: string;
  user_id: string;
  product_id: string;
};

const state = {
  headers: [] as HeaderRow[],
  headerInsertCount: 0,
  /** true 면 첫 select 가 (동시 삽입을 흉내 내) miss 를 반환한다. */
  raceFirstSelectMisses: false,
  headerSelectCount: 0,
  upsertPayloads: [] as Array<Record<string, unknown>>,
  upsertConflicts: [] as string[],
  callLog: [] as string[],
  listRows: [] as Array<Record<string, unknown>>,
  lastSelectColumns: '',
};

const probeState = { projectCart: true, calls: 0 };

vi.mock('@/lib/db/feature-probe', () => ({
  isProjectCartAvailable: async () => {
    probeState.calls += 1;
    return probeState.projectCart;
  },
}));

// cart_projects 쓰기는 service-role 경유 (034 RLS 는 회원 SELECT 만 허용).
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      if (table !== 'cart_projects') throw new Error(`Unmocked table: ${table}`);
      return {
        select: () => ({
          eq: (_c1: string, userId: string) => ({
            eq: (col: string, value: string) => ({
              maybeSingle: () => {
                if (col === 'id') {
                  // P2-002 PK 에코 가드 경로 — 헤더 PK 로 조회.
                  state.callLog.push('cart_projects.select_pk');
                  const hit = state.headers.find(
                    (h) => h.user_id === userId && h.id === value,
                  );
                  return Promise.resolve({
                    data: hit ? { id: hit.id } : null,
                    error: null,
                  });
                }
                state.callLog.push('cart_projects.select');
                state.headerSelectCount += 1;
                if (state.raceFirstSelectMisses && state.headerSelectCount === 1) {
                  return Promise.resolve({ data: null, error: null });
                }
                const found = state.headers.find(
                  (h) => h.user_id === userId && h.project_local_id === value,
                );
                return Promise.resolve({
                  data: found ? { id: found.id } : null,
                  error: null,
                });
              },
            }),
          }),
        }),
        insert: (row: Omit<HeaderRow, 'id'>) => ({
          select: () => ({
            single: () => {
              state.callLog.push('cart_projects.insert');
              const dup = state.headers.find(
                (h) =>
                  h.user_id === row.user_id &&
                  h.project_local_id === row.project_local_id,
              );
              if (dup) {
                // 034 partial unique index 위반 — Postgres 23505.
                return Promise.resolve({
                  data: null,
                  error: { code: '23505', message: 'duplicate key value' },
                });
              }
              state.headerInsertCount += 1;
              const id = `header-${state.headerInsertCount}`;
              state.headers.push({ id, ...row });
              return Promise.resolve({ data: { id }, error: null });
            },
          }),
        }),
      };
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: (table: string) => {
      if (table !== 'cart_items') throw new Error(`Unmocked table: ${table}`);
      return {
        upsert: (payload: Record<string, unknown>, opts: { onConflict: string }) => {
          state.callLog.push('cart_items.upsert');
          state.upsertPayloads.push(payload);
          state.upsertConflicts.push(opts.onConflict);
          return Promise.resolve({ error: null });
        },
        select: (columns: string) => {
          state.lastSelectColumns = columns;
          return {
            eq: () => ({
              order: () => Promise.resolve({ data: state.listRows, error: null }),
            }),
          };
        },
      };
    },
  }),
}));

async function importCartDb() {
  return import('@/lib/db/cart');
}

// ---------- Fixtures ----------

const USER_ID = asBrand<UserId>('user-1');
const PRODUCT_ID = asBrand<ProductId>('22222222-2222-2222-2222-222222222222');
const PROJECT_LOCAL = asBrand<ProjectLocalId>(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
);

/** upsertCartItem 의 현행(레거시) payload 컬럼 집합 — 회귀 고정용. */
const LEGACY_UPSERT_KEYS = [
  'local_id',
  'user_id',
  'variant_id',
  'photo_id',
  'options',
  'photo_url',
  'crop_transform',
  'preview_url',
  'price',
  'quantity',
].sort();

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    localId: asBrand<LocalId>('44444444-4444-4444-4444-444444444444'),
    userId: USER_ID,
    productId: PRODUCT_ID,
    variantId: asBrand<ProductVariantId>('11111111-1111-1111-1111-111111111111'),
    photoId: asBrand<PhotoId>('33333333-3333-3333-3333-333333333333'),
    options: { sizeCode: 'A4', colorCode: 'BLACK', matteCode: 'none', paperCode: 'glossy' },
    photoUrl: 'https://example.supabase.co/photo.jpg',
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    previewUrl: 'https://example.com/preview.jpg',
    price: 30000,
    quantity: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ci-1',
    local_id: '44444444-4444-4444-4444-444444444444',
    user_id: 'user-1',
    variant_id: '11111111-1111-1111-1111-111111111111',
    photo_id: '33333333-3333-3333-3333-333333333333',
    options: { sizeCode: 'A4', colorCode: 'BLACK', matteCode: 'none', paperCode: 'glossy' },
    photo_url: 'https://example.supabase.co/photo.jpg',
    crop_transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    preview_url: 'https://example.com/preview.jpg',
    price: 30000,
    quantity: 1,
    created_at: '2026-07-06T00:00:00.000Z',
    product_variants: { product_id: PRODUCT_ID as string },
    ...overrides,
  };
}

beforeEach(() => {
  state.headers = [];
  state.headerInsertCount = 0;
  state.raceFirstSelectMisses = false;
  state.headerSelectCount = 0;
  state.upsertPayloads = [];
  state.upsertConflicts = [];
  state.callLog = [];
  state.listRows = [];
  state.lastSelectColumns = '';
  probeState.projectCart = true;
  probeState.calls = 0;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------- upsertCartProject ----------

describe('upsertCartProject — 헤더 upsert + dedup (034)', () => {
  it('inserts a new header and returns its server id', async () => {
    const { upsertCartProject } = await importCartDb();
    const id = await upsertCartProject(USER_ID, PROJECT_LOCAL, PRODUCT_ID);
    expect(id as string).toBe('header-1');
    expect(state.headers).toHaveLength(1);
    expect(state.headers[0]).toMatchObject({
      project_local_id: PROJECT_LOCAL as string,
      user_id: USER_ID as string,
      product_id: PRODUCT_ID as string,
    });
  });

  it('dedups on (user_id, project_local_id) — N lines share ONE header', async () => {
    const { upsertCartProject } = await importCartDb();
    const first = await upsertCartProject(USER_ID, PROJECT_LOCAL, PRODUCT_ID);
    const second = await upsertCartProject(USER_ID, PROJECT_LOCAL, PRODUCT_ID);
    expect(second).toBe(first);
    expect(state.headerInsertCount).toBe(1);
  });

  it('recovers a lost insert race (23505) by re-selecting the winner', async () => {
    const { upsertCartProject } = await importCartDb();
    // 다른 요청이 이미 헤더를 만들었지만 첫 select 는 그 커밋을 못 본 상황.
    state.headers.push({
      id: 'header-winner',
      project_local_id: PROJECT_LOCAL as string,
      user_id: USER_ID as string,
      product_id: PRODUCT_ID as string,
    });
    state.raceFirstSelectMisses = true;

    const id = await upsertCartProject(USER_ID, PROJECT_LOCAL, PRODUCT_ID);
    expect(id as string).toBe('header-winner');
    // insert 시도 1회(23505) → re-select 로 수습, 새 행은 생기지 않는다.
    // (local_id miss 후 insert 전에 P2-002 PK 가드 select 가 한 번 낀다.)
    expect(state.headerInsertCount).toBe(0);
    expect(state.callLog).toEqual([
      'cart_projects.select',
      'cart_projects.select_pk',
      'cart_projects.insert',
      'cart_projects.select',
    ]);
  });

  it('reuses the header when the client echoes the server header PK back (P2-002 guard)', async () => {
    const { upsertCartProject } = await importCartDb();
    state.headers.push({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      project_local_id: PROJECT_LOCAL as string,
      user_id: USER_ID as string,
      product_id: PRODUCT_ID as string,
    });

    // GET /api/cart 가 projectId 로 노출한 서버 헤더 PK 를 그대로 되돌린 상황 —
    // 가드가 없으면 project_local_id = 기존 PK 인 중복 헤더가 생긴다.
    const id = await upsertCartProject(
      USER_ID,
      asBrand<ProjectLocalId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      PRODUCT_ID,
    );

    expect(id as string).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(state.headerInsertCount).toBe(0);
    expect(state.headers).toHaveLength(1);
  });
});

// ---------- upsertCartItem ----------

describe('upsertCartItem — probe 분기 (ADR-025 폴백 계약)', () => {
  it('probe true: upserts the header BEFORE the child row (FK order) and links it', async () => {
    const { upsertCartItem } = await importCartDb();
    await upsertCartItem(
      makeCartItem({
        projectId: asBrand<CartProjectId>(PROJECT_LOCAL as string),
        projectSeq: 2,
        orientation: 'landscape',
      }),
    );

    // FK 순서: cart_projects 헤더가 cart_items 보다 반드시 먼저.
    const childAt = state.callLog.indexOf('cart_items.upsert');
    const headerAt = state.callLog.findIndex((c) => c.startsWith('cart_projects.'));
    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(headerAt).toBeLessThan(childAt);

    const payload = state.upsertPayloads[0];
    // project_id 는 클라 로컬 키가 아니라 서버 헤더 PK 다.
    expect(payload.project_id).toBe('header-1');
    expect(payload.project_seq).toBe(2);
    expect(payload.orientation).toBe('landscape');
    expect(state.upsertConflicts[0]).toBe('user_id,local_id');
  });

  it('probe false: drops the project fields — the EXACT legacy flat payload (sync fallback)', async () => {
    const { upsertCartItem } = await importCartDb();
    probeState.projectCart = false;
    await upsertCartItem(
      makeCartItem({
        projectId: asBrand<CartProjectId>(PROJECT_LOCAL as string),
        projectSeq: 0,
        orientation: 'portrait',
      }),
    );

    // 헤더 접근 0 — cart_projects 테이블이 없는 DB 에서도 안전.
    expect(state.callLog).toEqual(['cart_items.upsert']);
    // 평면 저장: 컬럼 집합이 현행과 문자 그대로 동일(035 컬럼 키 자체가 없음).
    expect(Object.keys(state.upsertPayloads[0]).sort()).toEqual(LEGACY_UPSERT_KEYS);
    expect(probeState.calls).toBe(1);
  });

  it('legacy single item (no projectId): identical payload and the probe is never called', async () => {
    const { upsertCartItem } = await importCartDb();
    await upsertCartItem(makeCartItem());

    expect(Object.keys(state.upsertPayloads[0]).sort()).toEqual(LEGACY_UPSERT_KEYS);
    expect(probeState.calls).toBe(0);
    expect(state.callLog).toEqual(['cart_items.upsert']);
  });
});

// ---------- listCartForUser ----------

describe('listCartForUser — probe 별 SELECT 분기', () => {
  it('probe true: requests the extended columns and maps them onto the items', async () => {
    const { listCartForUser } = await importCartDb();
    state.listRows = [
      makeDbRow({ project_id: 'header-9', project_seq: 1, orientation: 'landscape' }),
      makeDbRow({ id: 'ci-2', project_id: null, project_seq: null, orientation: null }),
    ];

    const items = await listCartForUser(USER_ID);
    expect(state.lastSelectColumns).toContain(', project_id, project_seq, orientation');

    expect(items[0].projectId as string | undefined).toBe('header-9');
    expect(items[0].projectSeq).toBe(1);
    expect(items[0].orientation).toBe('landscape');
    // 레거시 행(NULL): 필드 자체가 없어 기존 item shape 그대로.
    expect('projectId' in items[1]).toBe(false);
    expect('projectSeq' in items[1]).toBe(false);
    expect('orientation' in items[1]).toBe(false);
  });

  it('probe false: requests the literal legacy column string (현행 경로 문자 그대로)', async () => {
    const { listCartForUser } = await importCartDb();
    probeState.projectCart = false;
    state.listRows = [makeDbRow()];

    const items = await listCartForUser(USER_ID);
    expect(state.lastSelectColumns).toBe(
      'id, local_id, user_id, variant_id, photo_id, options, photo_url, crop_transform, preview_url, price, quantity, created_at, product_variants(product_id)',
    );
    expect(items).toHaveLength(1);
    expect('projectId' in items[0]).toBe(false);
    expect(items[0].productId as string).toBe(PRODUCT_ID as string);
  });
});
