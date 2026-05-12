/**
 * Editor pure helpers (UT-02, UT-03, UT-08).
 *
 * Spec: docs/specs/editor.md.
 */

import { describe, expect, it } from 'vitest';
import {
  applyCropTransform,
  fitPhotoToFrame,
  lookupVariant,
  pickDefaultVariant,
} from '@/lib/editor/transform';
import { asBrand } from '@/types/common';
import type { ProductId, ProductVariantId } from '@/types/common';
import { variantKey, type ProductVariant, type SelectedOptions } from '@/types/product';

function variant(
  partial: Partial<ProductVariant> & Pick<ProductVariant, 'sizeCode' | 'colorCode'>,
): ProductVariant {
  return {
    id: asBrand<ProductVariantId>(`v-${partial.sizeCode}-${partial.colorCode}`),
    productId: asBrand<ProductId>('p1'),
    sizeCode: partial.sizeCode,
    sizeLabel: partial.sizeLabel ?? partial.sizeCode,
    widthMm: partial.widthMm ?? 100,
    heightMm: partial.heightMm ?? 150,
    colorCode: partial.colorCode,
    matteCode: partial.matteCode ?? 'none',
    paperCode: partial.paperCode ?? 'glossy',
    price: partial.price ?? 5000,
    stock: partial.stock ?? 99,
    isActive: partial.isActive ?? true,
  };
}

describe('lookupVariant (UT-08)', () => {
  const v1 = variant({ sizeCode: '4x6', colorCode: 'black' });
  const v2 = variant({ sizeCode: '4x6', colorCode: 'brown', price: 7000 });
  const matrix = {
    [variantKey({
      sizeCode: '4x6',
      colorCode: 'black',
      matteCode: 'none',
      paperCode: 'glossy',
    })]: v1,
    [variantKey({
      sizeCode: '4x6',
      colorCode: 'brown',
      matteCode: 'none',
      paperCode: 'glossy',
    })]: v2,
  };

  it('returns the variant when options match exactly', () => {
    const opts: SelectedOptions = {
      sizeCode: '4x6',
      colorCode: 'brown',
      matteCode: 'none',
      paperCode: 'glossy',
    };
    expect(lookupVariant({ variantsByKey: matrix, options: opts })).toBe(v2);
  });

  it('returns null when no variant matches', () => {
    const opts: SelectedOptions = {
      sizeCode: '4x6',
      colorCode: 'gold',
      matteCode: 'none',
      paperCode: 'glossy',
    };
    expect(lookupVariant({ variantsByKey: matrix, options: opts })).toBeNull();
  });

  it('pickDefaultVariant returns the cheapest', () => {
    expect(
      pickDefaultVariant({
        sizes: [],
        colors: [],
        mattes: [],
        papers: [],
        variantsByKey: matrix,
      }),
    ).toBe(v1);
  });
});

describe('applyCropTransform (UT-02)', () => {
  it('maps CropTransform fields into Konva image attrs', () => {
    const img = { width: 800, height: 600 };
    const attrs = applyCropTransform(img, {
      x: 100,
      y: 200,
      scale: 1.5,
      rotation: 90,
    });
    expect(attrs).toEqual({
      x: 100,
      y: 200,
      scaleX: 1.5,
      scaleY: 1.5,
      rotation: 90,
      offsetX: 400,
      offsetY: 300,
    });
  });
});

describe('fitPhotoToFrame (UT-03)', () => {
  const stage = { w: 600, h: 600 };
  const innerRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

  it('centers the photo over the inner rect', () => {
    const out = fitPhotoToFrame({ w: 1200, h: 800 }, innerRect, stage);
    // inner rect pixel center: (0.1*600 + 0.4*600, same) = (300, 300)
    expect(out.x).toBe(300);
    expect(out.y).toBe(300);
    expect(out.rotation).toBe(0);
  });

  it('uses fit-cover scale (max of dimensions)', () => {
    const out = fitPhotoToFrame({ w: 480, h: 480 }, innerRect, stage);
    // target = 480, photo = 480 → scale = 1.0
    expect(out.scale).toBeCloseTo(1.0, 5);
  });

  it('produces a scale that fully covers the rect even for tall photos', () => {
    const out = fitPhotoToFrame({ w: 200, h: 480 }, innerRect, stage);
    // target 480/200 = 2.4 vs 480/480 = 1.0 → 2.4
    expect(out.scale).toBeCloseTo(2.4, 5);
  });
});
