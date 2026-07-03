/**
 * Studio preselect resolution against the OptionMatrix (FS-EC-04).
 *
 * Invariants:
 *  - invalid codes are ignored individually (기존 기본값 유지)
 *  - nothing valid → null (caller falls through to the legacy draft-restore path)
 *  - resolved state always points at a REAL sellable variant
 */

import { describe, expect, it } from 'vitest';
import { resolveStudioPreselect } from '@/lib/wall/preselect';
import { asBrand } from '@/types/common';
import type { ProductId, ProductVariantId } from '@/types/common';
import {
  variantKey,
  type OptionMatrix,
  type ProductVariant,
  type SelectedOptions,
} from '@/types/product';

function variant(sizeCode: string, colorCode: string): ProductVariant {
  return {
    id: asBrand<ProductVariantId>(`v-${sizeCode}-${colorCode}`),
    productId: asBrand<ProductId>('p1'),
    sizeCode,
    sizeLabel: sizeCode,
    widthMm: 102,
    heightMm: 152,
    colorCode,
    matteCode: 'none',
    paperCode: 'glossy',
    price: 19000,
    stock: 10,
    isActive: true,
  };
}

function matrix(): OptionMatrix {
  const variants = [
    variant('4x6', 'black'),
    variant('4x6', 'white'),
    variant('A4', 'black'),
  ];
  const variantsByKey: Record<string, ProductVariant> = {};
  for (const v of variants) {
    variantsByKey[
      variantKey({
        sizeCode: v.sizeCode,
        colorCode: v.colorCode,
        matteCode: v.matteCode,
        paperCode: v.paperCode,
      })
    ] = v;
  }
  return {
    sizes: [
      { code: '4x6', label: '4×6', widthMm: 102, heightMm: 152 },
      { code: 'A4', label: 'A4', widthMm: 210, heightMm: 297 },
    ],
    colors: [
      { code: 'black', label: '블랙', previewUrl: null },
      { code: 'white', label: '화이트', previewUrl: null },
    ],
    mattes: [{ code: 'none', label: '없음' }],
    papers: [{ code: 'glossy', label: '유광' }],
    variantsByKey,
  };
}

const current = {
  selectedOptions: {
    sizeCode: '4x6',
    colorCode: 'black',
    matteCode: 'none',
    paperCode: 'glossy',
  } as SelectedOptions,
  selectedVariantId: asBrand<ProductVariantId>('v-4x6-black'),
  orientation: 'portrait' as const,
};

describe('resolveStudioPreselect', () => {
  it('유효한 size+color+orientation → 해당 variant로 해석', () => {
    const r = resolveStudioPreselect(
      { sizeCode: 'A4', colorCode: 'black', orientation: 'landscape' },
      matrix(),
      current,
    );
    expect(r).not.toBeNull();
    expect(r?.selectedOptions.sizeCode).toBe('A4');
    expect(r?.selectedOptions.colorCode).toBe('black');
    expect(r?.selectedVariantId).toBe('v-A4-black');
    expect(r?.orientation).toBe('landscape');
  });

  it('존재하지 않는 size 코드는 무시하고 color만 적용', () => {
    const r = resolveStudioPreselect(
      { sizeCode: 'B0', colorCode: 'white' },
      matrix(),
      current,
    );
    expect(r).not.toBeNull();
    expect(r?.selectedOptions.sizeCode).toBe('4x6'); // 기존 기본값 유지
    expect(r?.selectedOptions.colorCode).toBe('white');
    expect(r?.selectedVariantId).toBe('v-4x6-white');
  });

  it('size+color 조합 variant가 없으면 size 단독으로 완화한다 (A4는 black만 존재)', () => {
    const r = resolveStudioPreselect(
      { sizeCode: 'A4', colorCode: 'white' },
      matrix(),
      current,
    );
    expect(r).not.toBeNull();
    // A4+white 조합은 없음 → A4 단독 매칭(A4-black)으로 완화
    expect(r?.selectedOptions.sizeCode).toBe('A4');
    expect(r?.selectedVariantId).toBe('v-A4-black');
  });

  it('orientation만 있어도 적용된다(옵션 불변)', () => {
    const r = resolveStudioPreselect({ orientation: 'landscape' }, matrix(), current);
    expect(r).not.toBeNull();
    expect(r?.orientation).toBe('landscape');
    expect(r?.selectedOptions).toEqual(current.selectedOptions);
    expect(r?.selectedVariantId).toBe(current.selectedVariantId);
  });

  it('전부 무효 → null (레거시 경로 폴백)', () => {
    const r = resolveStudioPreselect(
      { sizeCode: 'nope', colorCode: 'nope' },
      matrix(),
      current,
    );
    expect(r).toBeNull();
  });

  it('빈 preselect → null', () => {
    expect(resolveStudioPreselect({}, matrix(), current)).toBeNull();
  });
});
