/**
 * getProductWorkspaceData — /admin/products/[id] 로더 이동 (P2, ADR-026).
 *
 * page 서버 컴포넌트에 인라인돼 있던 raw getServiceRoleSupabase 로더가 server-only
 * DB 계층으로 이동했음을 고정한다:
 *  (1) 상품/카테고리/프레임/변형 + 세트/규칙을 조립해 반환한다.
 *  (2) probe false 면 set_templates/bundle_rules 를 아예 쿼리하지 않는다(42P01 방지).
 *  (3) 상품 부재 → null(page 는 notFound).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { ProductId } from '@/types/common';

// ---------- Supabase 테스트 더블 (table 별 응답) ----------

type FakeResponse = { data: unknown; error: { message: string } | null };

const fromCalls: string[] = [];
let tableData: Record<string, unknown>;

type FakeQuery = PromiseLike<FakeResponse> & {
  select: (cols?: string) => FakeQuery;
  eq: (column: string, value: unknown) => FakeQuery;
  order: (col: string, opts?: { ascending: boolean }) => FakeQuery;
  maybeSingle: () => Promise<FakeResponse>;
};

function makeQuery(table: string): FakeQuery {
  const respond = (): FakeResponse => ({
    data: table in tableData ? tableData[table] : null,
    error: null,
  });
  const q: FakeQuery = {
    select: () => q,
    eq: () => q,
    order: () => q,
    maybeSingle: () => Promise.resolve(respond()),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(respond()).then(onFulfilled, onRejected),
  };
  return q;
}

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      return makeQuery(table);
    },
  }),
}));

// requireAdmin: admin 세션 스텁.
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: '99999999-9999-4999-8999-999999999999',
            email: 'admin@test.local',
            app_metadata: { role: 'admin' },
          },
        },
      }),
    },
  }),
}));

vi.mock('@/lib/db/catalog', () => ({
  getCategories: vi.fn(async () => []),
}));

vi.mock('@/lib/db/feature-probe', () => ({
  isSetTemplatesAvailable: vi.fn(async () => true),
  isBundleRulesAvailable: vi.fn(async () => true),
}));

import { getProductWorkspaceData } from '@/lib/db/admin';
import {
  isBundleRulesAvailable,
  isSetTemplatesAvailable,
} from '@/lib/db/feature-probe';

const isSetTemplatesAvailableMock = vi.mocked(isSetTemplatesAvailable);
const isBundleRulesAvailableMock = vi.mocked(isBundleRulesAvailable);

const PRODUCT_ID = asBrand<ProductId>('11111111-1111-4111-8111-111111111111');

const productRow = {
  id: PRODUCT_ID as string,
  category_id: 'cat-1',
  name: '테스트 액자',
  tagline: '',
  description: '',
  base_price: 10000,
  has_frame: true,
  is_active: true,
  sort_order: 0,
  bleed_mm: 0,
  product_type: 'extended',
  created_at: '2026-07-17T00:00:00Z',
};

function seedTables(overrides: Record<string, unknown> = {}): void {
  tableData = {
    products: productRow,
    frame_assets: [],
    product_variants: [],
    set_templates: [],
    bundle_rules: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls.length = 0;
  seedTables();
  isSetTemplatesAvailableMock.mockResolvedValue(true);
  isBundleRulesAvailableMock.mockResolvedValue(true);
});

describe('getProductWorkspaceData', () => {
  it('상품/카테고리/프레임/변형 + 세트/규칙을 조립해 반환한다 (probe true)', async () => {
    const data = await getProductWorkspaceData(PRODUCT_ID);
    expect(data).not.toBeNull();
    expect(data?.product.id).toBe(PRODUCT_ID);
    expect(data?.categories).toEqual([]);
    expect(data?.frames).toEqual([]);
    expect(data?.variants).toEqual([]);
    expect(data?.setTemplates).toEqual([]);
    expect(data?.bundleRule).toBeNull();
    expect(data?.setTemplatesAvailable).toBe(true);
    expect(data?.bundleRulesAvailable).toBe(true);
    // probe 통과 시에는 세트/규칙 테이블을 실제로 쿼리한다.
    expect(fromCalls).toContain('set_templates');
    expect(fromCalls).toContain('bundle_rules');
  });

  it('probe false → set_templates/bundle_rules 를 쿼리하지 않는다 (42P01 방지)', async () => {
    isSetTemplatesAvailableMock.mockResolvedValue(false);
    isBundleRulesAvailableMock.mockResolvedValue(false);

    const data = await getProductWorkspaceData(PRODUCT_ID);
    expect(data?.setTemplates).toEqual([]);
    expect(data?.bundleRule).toBeNull();
    expect(data?.setTemplatesAvailable).toBe(false);
    expect(data?.bundleRulesAvailable).toBe(false);
    expect(fromCalls).not.toContain('set_templates');
    expect(fromCalls).not.toContain('bundle_rules');
  });

  it('상품 부재 → null (page 는 notFound)', async () => {
    seedTables({ products: null });
    const data = await getProductWorkspaceData(PRODUCT_ID);
    expect(data).toBeNull();
    // 상품이 없으면 세트/규칙 로드까지 가지 않는다.
    expect(fromCalls).not.toContain('set_templates');
    expect(fromCalls).not.toContain('bundle_rules');
  });
});
