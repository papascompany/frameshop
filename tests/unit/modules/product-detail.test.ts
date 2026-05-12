/**
 * getProductDetail unit tests — P2-06 regression guard.
 *
 * Verifies that direct-URL access to a product whose parent category was
 * deactivated returns null (404). Without the categories.is_active join,
 * listings would hide the product but the detail page would still render.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { ProductId } from '@/types/common';

// ---------- Test doubles ----------

type ProductRowJoin = {
  id: string;
  category_id: string;
  name: string;
  tagline: string;
  description: string;
  base_price: number;
  has_frame: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  categories: { is_active: boolean } | null;
};

type FakeState = {
  productRow: ProductRowJoin | null;
};

const state: FakeState = { productRow: null };

function makeChain(table: string) {
  if (table === 'products') {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: state.productRow, error: null }),
          }),
        }),
      }),
    };
  }
  if (
    table === 'product_images' ||
    table === 'frame_assets' ||
    table === 'product_variants'
  ) {
    // The detail loader's Promise.all hits these even when productRow exists.
    // For the inactive-category path we return early, so this branch is
    // exercised only by the happy-path test (returns empty arrays).
    return {
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    };
  }
  throw new Error(`Unmocked table: ${table}`);
}

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: (table: string) => makeChain(table),
  }),
}));

async function importGetProductDetail() {
  const mod = await import('@/lib/db/product');
  return mod.getProductDetail;
}

// ---------- Fixtures ----------

const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const CATEGORY_ID = '11111111-1111-1111-1111-111111111111';

function makeProductRow(categoryActive: boolean): ProductRowJoin {
  return {
    id: PRODUCT_ID,
    category_id: CATEGORY_ID,
    name: 'Test Frame',
    tagline: 'tagline',
    description: 'desc',
    base_price: 30000,
    has_frame: true,
    is_active: true,
    sort_order: 1,
    created_at: new Date().toISOString(),
    categories: { is_active: categoryActive },
  };
}

beforeEach(() => {
  state.productRow = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- Tests ----------

describe('getProductDetail — P2-06 (category.is_active check)', () => {
  it('returns null when parent category is inactive', async () => {
    state.productRow = makeProductRow(/* categoryActive */ false);
    const getProductDetail = await importGetProductDetail();
    const result = await getProductDetail(asBrand<ProductId>(PRODUCT_ID));
    expect(result).toBeNull();
  });

  it('returns detail when both product and category are active', async () => {
    state.productRow = makeProductRow(/* categoryActive */ true);
    const getProductDetail = await importGetProductDetail();
    const result = await getProductDetail(asBrand<ProductId>(PRODUCT_ID));
    expect(result).not.toBeNull();
    expect(result?.product.id).toBe(PRODUCT_ID);
  });

  it('returns null when join produces no category row (orphaned product)', async () => {
    state.productRow = { ...makeProductRow(true), categories: null };
    const getProductDetail = await importGetProductDetail();
    const result = await getProductDetail(asBrand<ProductId>(PRODUCT_ID));
    expect(result).toBeNull();
  });
});
