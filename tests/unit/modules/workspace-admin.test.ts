/**
 * FS-X-03 어드민 워크스페이스 — 순수 계층 검증.
 *
 *  (1) productFormSchema.productType — FROZEN 옵셔널 추가 계약(부재 허용, 오값 거부).
 *  (2) setTemplateInputSchema — 슬롯 폼 zod 경계(빈/과다 슬롯, slotPos 0 크기 금지).
 *  (3) bundleRuleInputSchema superRefine — 전략별 필수값 + 슬롯 범위.
 *  (4) visibleWorkspaceTabs — 확장형 전용 탭 + probe false 게이트.
 *  (5) buildSetTemplatePreview — slots → PlacedWallItem mm 변환(벽/그리드 모드).
 */

import { describe, expect, it } from 'vitest';
import { productFormSchema } from '@/types/admin';
import { bundleRuleInputSchema, setTemplateInputSchema } from '@/types/set';
import { visibleWorkspaceTabs } from '@/app/admin/products/[id]/workspace-tabs';
import {
  buildSetTemplatePreview,
  type SlotSizeInfo,
} from '@/modules/wall/set-template-adapter';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const baseProductForm = {
  name: '테스트 액자',
  categoryId: 'cat-1',
  tagline: '',
  description: '',
  basePrice: 10000,
  hasFrame: true,
  isActive: true,
  sortOrder: 0,
  bleedMm: 0,
};

// ---------- (1) productFormSchema.productType ----------

describe('productFormSchema productType (옵셔널 추가)', () => {
  it('accepts payloads without productType (기존 폼 무회귀) and with valid values', () => {
    expect(productFormSchema.safeParse(baseProductForm).success).toBe(true);
    expect(
      productFormSchema.safeParse({ ...baseProductForm, productType: 'extended' }).success,
    ).toBe(true);
    expect(
      productFormSchema.safeParse({ ...baseProductForm, productType: 'single' }).success,
    ).toBe(true);
  });

  it('rejects unknown productType values', () => {
    expect(
      productFormSchema.safeParse({ ...baseProductForm, productType: 'bundle' }).success,
    ).toBe(false);
  });
});

// ---------- (2) setTemplateInputSchema 슬롯 경계 ----------

describe('setTemplateInputSchema 슬롯 폼 경계', () => {
  const slot = (i: number) => ({
    slotIndex: i,
    sizeCode: '4x6',
    orientation: 'portrait' as const,
  });

  it('accepts a grid-mode template (slotPos/wall 없음) and a wall-mode template', () => {
    expect(
      setTemplateInputSchema.safeParse({
        productId: PRODUCT_ID,
        name: '그리드 세트',
        slots: [slot(0), slot(1)],
      }).success,
    ).toBe(true);
    expect(
      setTemplateInputSchema.safeParse({
        productId: PRODUCT_ID,
        name: '벽모드 세트',
        slots: [
          { ...slot(0), slotPos: { xMm: 100, yMm: 200, wMm: 102, hMm: 152 } },
        ],
        wallWMm: 3000,
        wallHMm: 2300,
      }).success,
    ).toBe(true);
  });

  it('rejects empty slots, >50 slots, negative slotIndex, and zero-size slotPos', () => {
    expect(
      setTemplateInputSchema.safeParse({
        productId: PRODUCT_ID,
        name: '빈 세트',
        slots: [],
      }).success,
    ).toBe(false);
    expect(
      setTemplateInputSchema.safeParse({
        productId: PRODUCT_ID,
        name: '과다 세트',
        slots: Array.from({ length: 51 }, (_, i) => slot(i)),
      }).success,
    ).toBe(false);
    expect(
      setTemplateInputSchema.safeParse({
        productId: PRODUCT_ID,
        name: '음수 인덱스',
        slots: [{ ...slot(0), slotIndex: -1 }],
      }).success,
    ).toBe(false);
    expect(
      setTemplateInputSchema.safeParse({
        productId: PRODUCT_ID,
        name: '0 크기 슬롯',
        slots: [{ ...slot(0), slotPos: { xMm: 0, yMm: 0, wMm: 0, hMm: 152 } }],
      }).success,
    ).toBe(false);
  });
});

// ---------- (3) bundleRuleInputSchema superRefine ----------

describe('bundleRuleInputSchema 전략별 필수값 (superRefine)', () => {
  const baseRule = {
    productId: PRODUCT_ID,
    minSlots: 2,
    maxSlots: 6,
    allowedSizeCodes: [],
    allowedOrientations: [],
    allowSizeMix: true,
    allowOrientationMix: true,
    allowPhotoReuse: true,
  };

  it('rejects maxSlots < minSlots and missing strategy-conditional fields', () => {
    expect(
      bundleRuleInputSchema.safeParse({
        ...baseRule,
        minSlots: 5,
        maxSlots: 2,
        pricingStrategy: 'sum',
      }).success,
    ).toBe(false);
    expect(
      bundleRuleInputSchema.safeParse({
        ...baseRule,
        pricingStrategy: 'sum_with_discount',
      }).success,
    ).toBe(false);
    expect(
      bundleRuleInputSchema.safeParse({ ...baseRule, pricingStrategy: 'flat' }).success,
    ).toBe(false);
  });

  it('accepts each strategy with its required field present', () => {
    expect(
      bundleRuleInputSchema.safeParse({ ...baseRule, pricingStrategy: 'sum' }).success,
    ).toBe(true);
    expect(
      bundleRuleInputSchema.safeParse({
        ...baseRule,
        pricingStrategy: 'sum_with_discount',
        discountBps: 1000,
      }).success,
    ).toBe(true);
    expect(
      bundleRuleInputSchema.safeParse({
        ...baseRule,
        pricingStrategy: 'flat',
        flatPrice: 99000,
      }).success,
    ).toBe(true);
  });
});

// ---------- (4) visibleWorkspaceTabs 게이트 ----------

describe('visibleWorkspaceTabs', () => {
  it('single 상품에는 구성규칙/세트템플릿 탭이 없다', () => {
    const tabs = visibleWorkspaceTabs({
      productType: 'single',
      setTemplatesAvailable: true,
      bundleRulesAvailable: true,
    });
    expect(tabs.map((t) => t.id)).toEqual(['type', 'attrs', 'frames', 'options']);
  });

  it('extended + probe true 면 6탭 전부 활성', () => {
    const tabs = visibleWorkspaceTabs({
      productType: 'extended',
      setTemplatesAvailable: true,
      bundleRulesAvailable: true,
    });
    expect(tabs.map((t) => t.id)).toEqual([
      'type',
      'attrs',
      'frames',
      'options',
      'bundleRule',
      'setTemplates',
    ]);
    expect(tabs.every((t) => !t.disabled)).toBe(true);
  });

  it('probe false 면 해당 탭이 disabled + 사유 안내 (42P01 UI 유출 방지)', () => {
    const tabs = visibleWorkspaceTabs({
      productType: 'extended',
      setTemplatesAvailable: false,
      bundleRulesAvailable: false,
    });
    const bundleTab = tabs.find((t) => t.id === 'bundleRule');
    const setTab = tabs.find((t) => t.id === 'setTemplates');
    expect(bundleTab?.disabled).toBe(true);
    expect(setTab?.disabled).toBe(true);
    expect(setTab?.disabledReason).toMatch(/마이그레이션/);
  });
});

// ---------- (5) buildSetTemplatePreview 어댑터 ----------

const SIZES: SlotSizeInfo[] = [
  { sizeCode: '4x6', sizeLabel: '4x6', widthMm: 102, heightMm: 152, variantId: 'v-46' },
  { sizeCode: '8x10', sizeLabel: '8x10', widthMm: 203, heightMm: 254, variantId: 'v-810' },
];

const FRAME = { frameUrl: 'https://cdn.test/frame.png', colorCode: 'black', colorLabel: '블랙' };

describe('buildSetTemplatePreview (slots → PlacedWallItem mm)', () => {
  it('벽모드: slotPos mm 를 그대로 배치하고 wall cm 로 환산한다', () => {
    const model = buildSetTemplatePreview({
      productId: PRODUCT_ID,
      slots: [
        {
          slotIndex: 0,
          sizeCode: '4x6',
          orientation: 'portrait',
          slotPos: { xMm: 100, yMm: 200, wMm: 102, hMm: 152 },
        },
      ],
      wallWMm: 3000,
      wallHMm: 2300,
      sizes: SIZES,
      frame: FRAME,
    });

    expect(model.wallWidthCm).toBe(300);
    expect(model.wallHeightCm).toBe(230);
    expect(model.items).toHaveLength(1);
    expect(model.items[0]).toMatchObject({
      id: 'slot-0',
      productId: PRODUCT_ID,
      variantId: 'v-46',
      xMm: 100,
      yMm: 200,
      wMm: 102,
      hMm: 152,
      orientation: 'portrait',
      frameUrl: FRAME.frameUrl,
      price: 0,
    });
  });

  it('orientation 이 landscape 면 slotPos 없는 슬롯의 실측이 회전된다', () => {
    const model = buildSetTemplatePreview({
      productId: PRODUCT_ID,
      slots: [
        { slotIndex: 0, sizeCode: '4x6', orientation: 'landscape' },
        { slotIndex: 1, sizeCode: '4x6', orientation: 'portrait' },
      ],
      wallWMm: null,
      wallHMm: null,
      sizes: SIZES,
      frame: FRAME,
    });

    // landscape = 가로가 김(152×102), portrait = 세로가 김(102×152).
    expect(model.items[0]).toMatchObject({ wMm: 152, hMm: 102 });
    expect(model.items[1]).toMatchObject({ wMm: 102, hMm: 152 });
    // 그리드모드: 좌→우 일렬(겹침 없음) + 합성 벽 안에 수납.
    expect(model.items[1]!.xMm).toBeGreaterThan(model.items[0]!.xMm + model.items[0]!.wMm - 1);
    const wallWMm = model.wallWidthCm * 10;
    for (const item of model.items) {
      expect(item.xMm + item.wMm).toBeLessThanOrEqual(wallWMm);
    }
  });

  it('옵션 매트릭스에 없는 sizeCode 슬롯은 제외하고, slotPos 는 벽 안으로 클램프한다', () => {
    const model = buildSetTemplatePreview({
      productId: PRODUCT_ID,
      slots: [
        { slotIndex: 0, sizeCode: 'unknown', orientation: 'portrait' },
        {
          slotIndex: 1,
          sizeCode: '8x10',
          orientation: 'portrait',
          // 벽(1000×1000) 밖 좌표 — 클램프 대상.
          slotPos: { xMm: 5000, yMm: 5000, wMm: 203, hMm: 254 },
        },
      ],
      wallWMm: 1000,
      wallHMm: 1000,
      sizes: SIZES,
      frame: null,
    });

    expect(model.items).toHaveLength(1);
    expect(model.items[0]).toMatchObject({
      id: 'slot-1',
      xMm: 1000 - 203,
      yMm: 1000 - 254,
      colorCode: 'preview',
      frameUrl: '',
    });
  });
});
