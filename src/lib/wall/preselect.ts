/**
 * Studio preselect resolution (FS-EC-04).
 *
 * Maps a parsed deep-link preselect (size/color/orientation) onto a product's
 * OptionMatrix, producing the INITIAL option state to inject into the editor
 * store. Pure function — unit-testable without React/Konva.
 *
 * Semantics (컨텍스트 패키지 §4):
 *  - Applied ONCE on initial mount, by direct state injection — NOT via
 *    setSize/setOrientation (those clear the tray; injection at init time has
 *    no side effects because the tray is empty).
 *  - Invalid codes are ignored individually (기존 기본값 유지).
 *  - Returns null when NOTHING applies → caller falls through to the legacy
 *    path (draft restore) unchanged.
 */

import {
  variantKey,
  type OptionMatrix,
  type ProductVariant,
  type SelectedOptions,
} from '@/types/product';
import type { ProductVariantId } from '@/types/common';
import type { StudioOrientation, StudioPreselect } from './deeplink';

export type ResolvedStudioPreselect = {
  selectedOptions: SelectedOptions;
  selectedVariantId: ProductVariantId | null;
  orientation: StudioOrientation;
};

/**
 * Find a variant matching the desired size/color axes. Prefers the current
 * matte/paper choice; falls back to ANY matte/paper combination that exists
 * for the requested size+color (the deep link only carries size/color).
 */
function findVariant(
  variants: ProductVariant[],
  sizeCode: string | undefined,
  colorCode: string | undefined,
  prefer: Pick<SelectedOptions, 'matteCode' | 'paperCode'>,
): ProductVariant | null {
  const matches = variants.filter(
    (v) =>
      (sizeCode === undefined || v.sizeCode === sizeCode) &&
      (colorCode === undefined || v.colorCode === colorCode),
  );
  if (matches.length === 0) return null;
  return (
    matches.find(
      (v) => v.matteCode === prefer.matteCode && v.paperCode === prefer.paperCode,
    ) ?? matches[0]
  );
}

export function resolveStudioPreselect(
  preselect: StudioPreselect,
  matrix: OptionMatrix,
  current: {
    selectedOptions: SelectedOptions;
    selectedVariantId: ProductVariantId | null;
    orientation: StudioOrientation;
  },
): ResolvedStudioPreselect | null {
  // Validate codes against the matrix axes; invalid ones are dropped.
  const sizeCode =
    preselect.sizeCode !== undefined &&
    matrix.sizes.some((s) => s.code === preselect.sizeCode)
      ? preselect.sizeCode
      : undefined;
  const colorCode =
    preselect.colorCode !== undefined &&
    matrix.colors.some((c) => c.code === preselect.colorCode)
      ? preselect.colorCode
      : undefined;
  const orientation = preselect.orientation;

  if (sizeCode === undefined && colorCode === undefined && orientation === undefined) {
    return null; // nothing valid — caller keeps legacy behaviour
  }

  let selectedOptions = current.selectedOptions;
  let selectedVariantId = current.selectedVariantId;

  if (sizeCode !== undefined || colorCode !== undefined) {
    const variants = Object.values(matrix.variantsByKey);
    const prefer = {
      matteCode: current.selectedOptions.matteCode,
      paperCode: current.selectedOptions.paperCode,
    };
    // Try the most specific combination first, then relax per-axis so a
    // partially valid deep link still applies what it can.
    const variant =
      findVariant(variants, sizeCode, colorCode, prefer) ??
      (sizeCode !== undefined ? findVariant(variants, sizeCode, undefined, prefer) : null) ??
      (colorCode !== undefined ? findVariant(variants, undefined, colorCode, prefer) : null);
    if (variant) {
      selectedOptions = {
        sizeCode: variant.sizeCode,
        colorCode: variant.colorCode,
        matteCode: variant.matteCode,
        paperCode: variant.paperCode,
      };
      selectedVariantId =
        matrix.variantsByKey[variantKey(selectedOptions)]?.id ?? variant.id;
    } else if (orientation === undefined) {
      return null; // size/color requested but no sellable variant, no orientation
    }
  }

  return {
    selectedOptions,
    selectedVariantId,
    orientation: orientation ?? current.orientation,
  };
}
