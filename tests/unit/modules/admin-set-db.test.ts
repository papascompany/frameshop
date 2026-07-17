/**
 * src/lib/db/admin.ts — FS-X-03 세트/규칙 CRUD + upsertProduct product_type.
 *
 * 핵심 계약:
 *  (1) upsertProduct 는 productType 미지정 시 product_type 컬럼을 payload 에
 *      아예 넣지 않는다(INSERT DEFAULT / UPDATE 기존값 유지) — 지정 시에만 포함.
 *  (2) upsertBundleRule 은 product_id 1:1 UNIQUE 를 onConflict 키로 upsert 한다
 *      (upsertFrameAsset 패턴).
 *  (3) upsertSetTemplate 은 id 유무로 insert/update 를 분기한다.
 *  (4) getBundleRule 은 규칙 부재 시 null(maybeSingle) — 던지지 않는다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { CategoryId, ProductId, SetTemplateId } from '@/types/common';
import type { SetTemplateSlot } from '@/types/set';

// ---------- Supabase 테스트 더블 ----------

type FakeResponse = { data: unknown; error: { message: string } | null };

type RecordedCall = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  payload?: unknown;
  options?: Record<string, unknown>;
  filters: Array<{ column: string; value: unknown }>;
};

const recorded: RecordedCall[] = [];
/** `${table}.${op}` → 응답. 미설정 시 { data: null, error: null }. */
const responses = new Map<string, FakeResponse>();

type FakeQuery = PromiseLike<FakeResponse> & {
  select: (cols?: string) => FakeQuery;
  eq: (column: string, value: unknown) => FakeQuery;
  order: (col: string, opts?: { ascending: boolean }) => FakeQuery;
  single: () => Promise<FakeResponse>;
  maybeSingle: () => Promise<FakeResponse>;
};

function makeQuery(
  table: string,
  op: RecordedCall['op'],
  payload?: unknown,
  options?: Record<string, unknown>,
): FakeQuery {
  const call: RecordedCall = { table, op, payload, options, filters: [] };
  recorded.push(call);
  const respond = (): FakeResponse =>
    responses.get(`${table}.${op}`) ?? { data: null, error: null };
  const q: FakeQuery = {
    select: () => q,
    eq: (column, value) => {
      call.filters.push({ column, value });
      return q;
    },
    order: () => q,
    single: () => Promise.resolve(respond()),
    maybeSingle: () => Promise.resolve(respond()),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(respond()).then(onFulfilled, onRejected),
  };
  return q;
}

function makeTable(table: string) {
  return {
    select: (_cols: string) => makeQuery(table, 'select'),
    insert: (payload: unknown) => makeQuery(table, 'insert', payload),
    update: (payload: unknown) => makeQuery(table, 'update', payload),
    upsert: (payload: unknown, options?: Record<string, unknown>) =>
      makeQuery(table, 'upsert', payload, options),
    delete: () => makeQuery(table, 'delete'),
  };
}

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleSupabase: () => ({ from: makeTable }),
}));

// requireAdmin 은 세션 클라이언트로 JWT role 을 재검증한다 — admin 세션 스텁.
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

import {
  upsertProduct,
  upsertSetTemplate,
  deleteSetTemplate,
  toggleSetTemplateActive,
  listSetTemplates,
  getBundleRule,
  upsertBundleRule,
  setProductType,
} from '@/lib/db/admin';

// ---------- Fixtures ----------

const PRODUCT_ID = asBrand<ProductId>('11111111-1111-4111-8111-111111111111');
const TEMPLATE_ID = asBrand<SetTemplateId>('22222222-2222-4222-8222-222222222222');

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

const productFormInput = {
  categoryId: asBrand<CategoryId>('cat-1'),
  name: '테스트 액자',
  tagline: '',
  description: '',
  basePrice: 10000,
  hasFrame: true,
  isActive: true,
  sortOrder: 0,
  bleedMm: 0,
};

const templateSlots: SetTemplateSlot[] = [
  {
    slotIndex: 0,
    sizeCode: '4x6',
    orientation: 'portrait',
    slotPos: { xMm: 100, yMm: 200, wMm: 102, hMm: 152 },
  },
];

const templateRow = {
  id: TEMPLATE_ID as string,
  product_id: PRODUCT_ID as string,
  name: '3종 세트',
  slots: templateSlots,
  wall_w_mm: 3000,
  wall_h_mm: 2300,
  set_price: null,
  set_discount_bps: null,
  is_active: true,
  created_at: '2026-07-17T00:00:00Z',
};

const ruleRow = {
  id: '33333333-3333-4333-8333-333333333333',
  product_id: PRODUCT_ID as string,
  min_slots: 2,
  max_slots: 6,
  allowed_size_codes: ['4x6', '5x7'],
  allowed_orientations: ['portrait'],
  allow_size_mix: true,
  allow_orientation_mix: false,
  allow_photo_reuse: true,
  pricing_strategy: 'sum_with_discount',
  discount_bps: 1000,
  flat_price: null,
  is_active: true,
  created_at: '2026-07-17T00:00:00Z',
};

beforeEach(() => {
  recorded.length = 0;
  responses.clear();
});

// ---------- upsertProduct / setProductType ----------

describe('upsertProduct product_type (ADR-026)', () => {
  it('omits product_type from the payload when productType is unspecified', async () => {
    responses.set('products.update', { data: productRow, error: null });
    await upsertProduct({ ...productFormInput, id: PRODUCT_ID });

    const update = recorded.find((c) => c.table === 'products' && c.op === 'update');
    expect(update).toBeDefined();
    expect(
      Object.prototype.hasOwnProperty.call(update!.payload, 'product_type'),
    ).toBe(false);
  });

  it('includes product_type on explicit promotion (update path)', async () => {
    responses.set('products.update', { data: productRow, error: null });
    const result = await upsertProduct({
      ...productFormInput,
      id: PRODUCT_ID,
      productType: 'extended',
    });

    const update = recorded.find((c) => c.table === 'products' && c.op === 'update');
    expect(update!.payload).toMatchObject({ product_type: 'extended' });
    expect(update!.filters).toContainEqual({ column: 'id', value: PRODUCT_ID as string });
    expect(result.productType).toBe('extended');
  });

  it('setProductType issues a targeted product_type-only update', async () => {
    await setProductType(PRODUCT_ID, 'extended');

    const update = recorded.find((c) => c.table === 'products' && c.op === 'update');
    expect(update!.payload).toEqual({ product_type: 'extended' });
    expect(update!.filters).toContainEqual({ column: 'id', value: PRODUCT_ID as string });
  });
});

// ---------- set_templates CRUD ----------

describe('set_templates CRUD', () => {
  it('upsertSetTemplate without id inserts a snake_case row and maps the result', async () => {
    responses.set('set_templates.insert', { data: templateRow, error: null });
    const result = await upsertSetTemplate({
      productId: PRODUCT_ID as string,
      name: '3종 세트',
      slots: templateRow.slots,
      wallWMm: 3000,
      wallHMm: 2300,
    });

    const insert = recorded.find((c) => c.table === 'set_templates' && c.op === 'insert');
    expect(insert!.payload).toMatchObject({
      product_id: PRODUCT_ID as string,
      name: '3종 세트',
      wall_w_mm: 3000,
      wall_h_mm: 2300,
      set_price: null,
      set_discount_bps: null,
      is_active: true,
    });
    expect(result.id).toBe(TEMPLATE_ID);
    expect(result.wallWMm).toBe(3000);
    expect(result.slots).toHaveLength(1);
  });

  it('upsertSetTemplate with id takes the update path filtered by id', async () => {
    responses.set('set_templates.update', { data: templateRow, error: null });
    await upsertSetTemplate({
      id: TEMPLATE_ID,
      productId: PRODUCT_ID as string,
      name: '3종 세트',
      slots: templateRow.slots,
    });

    expect(
      recorded.some((c) => c.table === 'set_templates' && c.op === 'insert'),
    ).toBe(false);
    const update = recorded.find((c) => c.table === 'set_templates' && c.op === 'update');
    expect(update!.filters).toContainEqual({
      column: 'id',
      value: TEMPLATE_ID as string,
    });
  });

  it('deleteSetTemplate / toggleSetTemplateActive target the row by id', async () => {
    await deleteSetTemplate(TEMPLATE_ID);
    await toggleSetTemplateActive(TEMPLATE_ID, false);

    const del = recorded.find((c) => c.table === 'set_templates' && c.op === 'delete');
    expect(del!.filters).toContainEqual({ column: 'id', value: TEMPLATE_ID as string });
    const toggle = recorded.find((c) => c.table === 'set_templates' && c.op === 'update');
    expect(toggle!.payload).toEqual({ is_active: false });
  });

  it('listSetTemplates maps rows to the camelCase domain view', async () => {
    responses.set('set_templates.select', { data: [templateRow], error: null });
    const result = await listSetTemplates(PRODUCT_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      productId: PRODUCT_ID,
      name: '3종 세트',
      wallWMm: 3000,
      wallHMm: 2300,
      isActive: true,
    });
    expect(result[0]!.slots[0]!.slotPos).toEqual({ xMm: 100, yMm: 200, wMm: 102, hMm: 152 });
  });
});

// ---------- bundle_rules (상품 1:1) ----------

describe('bundle_rules 1:1', () => {
  it('getBundleRule returns null when no rule exists (maybeSingle)', async () => {
    responses.set('bundle_rules.select', { data: null, error: null });
    await expect(getBundleRule(PRODUCT_ID)).resolves.toBeNull();
  });

  it('upsertBundleRule upserts with onConflict product_id and maps the row', async () => {
    responses.set('bundle_rules.upsert', { data: ruleRow, error: null });
    const result = await upsertBundleRule({
      productId: PRODUCT_ID as string,
      minSlots: 2,
      maxSlots: 6,
      allowedSizeCodes: ['4x6', '5x7'],
      allowedOrientations: ['portrait'],
      allowSizeMix: true,
      allowOrientationMix: false,
      allowPhotoReuse: true,
      pricingStrategy: 'sum_with_discount',
      discountBps: 1000,
    });

    const upsert = recorded.find((c) => c.table === 'bundle_rules' && c.op === 'upsert');
    expect(upsert!.options).toEqual({ onConflict: 'product_id' });
    expect(upsert!.payload).toMatchObject({
      product_id: PRODUCT_ID as string,
      min_slots: 2,
      max_slots: 6,
      pricing_strategy: 'sum_with_discount',
      discount_bps: 1000,
      flat_price: null,
      is_active: true,
    });
    expect(result.pricingStrategy).toBe('sum_with_discount');
    expect(result.allowedOrientations).toEqual(['portrait']);
  });

  it('upsertBundleRule surfaces DB errors as thrown Errors', async () => {
    responses.set('bundle_rules.upsert', {
      data: null,
      error: { message: 'duplicate key (simulated)' },
    });
    await expect(
      upsertBundleRule({
        productId: PRODUCT_ID as string,
        minSlots: 1,
        maxSlots: 1,
        allowedSizeCodes: [],
        allowedOrientations: [],
        allowSizeMix: true,
        allowOrientationMix: true,
        allowPhotoReuse: true,
        pricingStrategy: 'sum',
      }),
    ).rejects.toThrow(/upsertBundleRule/);
  });
});
