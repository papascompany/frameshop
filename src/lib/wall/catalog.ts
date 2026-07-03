/**
 * Wall simulator catalog read-model types (FS-EC-04).
 *
 * Isomorphic (no server-only imports) so both the server query
 * (`src/lib/db/wall.ts`) and the client (`WallClient`) can share them.
 * NOT part of the frozen domain types — this is a page-local read model.
 */

import type { ProductId, ProductVariantId } from '@/types/common';

/** One selectable size — 같은 sizeCode 중 최저가 variant 1개가 대표. */
export type WallCatalogSize = {
  variantId: ProductVariantId;
  sizeCode: string;
  sizeLabel: string;
  /** Physical size as stored on the variant row (pre-orientation). */
  widthMm: number;
  heightMm: number;
  /** Lowest active price for this size (대표가). */
  price: number;
};

/** One selectable frame colour (from frame_assets). */
export type WallCatalogColor = {
  code: string;
  label: string;
  /** Frame overlay PNG rendered on the wall canvas. */
  pngUrl: string;
  previewUrl: string | null;
};

export type WallCatalogProduct = {
  productId: ProductId;
  name: string;
  sizes: WallCatalogSize[];
  colors: WallCatalogColor[];
};
