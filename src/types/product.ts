/**
 * Product / Catalog domain types.
 *
 * Sources:
 *  - docs/PLAN.md §6 (DB schema) and Appendix A (Product, FrameAsset, ProductVariant).
 *  - docs/specs/catalog.md, docs/specs/product.md.
 *  - shared/HANDOFF.md: split ProductListItem (with joined thumbnail) from
 *    Product (table row).
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import { z } from 'zod';
import type {
  CategoryId,
  ProductId,
  ProductImageId,
  FrameAssetId,
  ProductVariantId,
  IsoTimestamp,
} from './common';

// ---------- Enums / unions ----------

export const MATTE_CODES = ['none', 'with'] as const;
export type MatteCode = (typeof MATTE_CODES)[number];

export const PAPER_CODES = ['glossy', 'matte', 'fineart'] as const;
export type PaperCode = (typeof PAPER_CODES)[number];

export const PRODUCT_IMAGE_TYPES = ['thumbnail', 'gallery', 'guide'] as const;
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number];

// ---------- Tables ----------

export type Category = {
  id: CategoryId;
  slug: string;
  name: string;
  parentId: CategoryId | null;
  sortOrder: number;
  isActive: boolean;
};

/** Recursive tree node returned by getCategories(). */
export type CategoryTreeNode = Category & {
  children: CategoryTreeNode[];
};

/**
 * `products` table row. NOTE: `thumbnail` is NOT a column on the table — it
 * is computed by joining `product_images`. Use `ProductListItem` when you
 * need a product with its thumbnail attached.
 */
export type Product = {
  id: ProductId;
  categoryId: CategoryId;
  name: string;
  tagline: string;
  description: string;
  basePrice: number;
  hasFrame: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Print bleed in mm added around inner_rect when generating the print crop. */
  bleedMm: number;
  createdAt: IsoTimestamp;
};

/** Product + joined thumbnail URL (catalog list, landing grid). */
export type ProductListItem = Product & {
  thumbnail: string | null;
};

export type ProductImage = {
  id: ProductImageId;
  productId: ProductId;
  imageUrl: string;
  altText: string | null;
  type: ProductImageType;
  sortOrder: number;
};

/** Normalized 0~1 rectangle for the frame's inner (photo) region. */
export type InnerRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type FrameAsset = {
  id: FrameAssetId;
  productId: ProductId;
  colorCode: string;
  colorLabel: string;
  pngUrl: string;
  innerRect: InnerRect;
  previewUrl: string | null;
};

export type ProductVariant = {
  id: ProductVariantId;
  productId: ProductId;
  sizeCode: string;
  sizeLabel: string;
  widthMm: number;
  heightMm: number;
  colorCode: string;
  matteCode: MatteCode;
  paperCode: PaperCode;
  price: number;
  stock: number;
  isActive: boolean;
};

// ---------- Aggregate (read-model) types ----------

export type ProductDetail = {
  product: Product;
  images: {
    thumbnail: ProductImage[];
    gallery: ProductImage[];
    guide: ProductImage[];
  };
  frames: FrameAsset[];
  defaultVariantId: ProductVariantId | null;
  startingPrice: number;
};

/**
 * Option axes + lookup map for the editor.
 * variantsByKey key format: `${sizeCode}|${colorCode}|${matteCode}|${paperCode}`.
 */
export type OptionMatrix = {
  sizes: Array<{ code: string; label: string; widthMm: number; heightMm: number }>;
  colors: Array<{ code: string; label: string; previewUrl: string | null }>;
  mattes: Array<{ code: MatteCode; label: string }>;
  papers: Array<{ code: PaperCode; label: string }>;
  variantsByKey: Record<string, ProductVariant>;
};

/** The user's current option choices (subset of variant axes). */
export type SelectedOptions = {
  sizeCode: string;
  colorCode: string;
  matteCode: MatteCode;
  paperCode: PaperCode;
};

/** Build the lookup key used in `variantsByKey`. */
export function variantKey(opts: SelectedOptions): string {
  return `${opts.sizeCode}|${opts.colorCode}|${opts.matteCode}|${opts.paperCode}`;
}

// ---------- Catalog list query types ----------

export const PRODUCT_SORTS = ['default', 'priceAsc', 'priceDesc', 'newest'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export type ProductListQuery = {
  page?: number;
  pageSize?: number;
  hasFrame?: boolean;
  sort?: ProductSort;
};

export type ProductListResult = {
  items: ProductListItem[];
  total: number;
  hasMore: boolean;
  page: number;
  pageSize: number;
};

// ---------- Zod schemas (for runtime validation at IO boundaries) ----------

export const innerRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const matteCodeSchema = z.enum(MATTE_CODES);
export const paperCodeSchema = z.enum(PAPER_CODES);
export const productImageTypeSchema = z.enum(PRODUCT_IMAGE_TYPES);
export const productSortSchema = z.enum(PRODUCT_SORTS);

export const selectedOptionsSchema = z.object({
  sizeCode: z.string().min(1),
  colorCode: z.string().min(1),
  matteCode: matteCodeSchema,
  paperCode: paperCodeSchema,
});

export const productListQuerySchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  hasFrame: z.boolean().optional(),
  sort: productSortSchema.optional(),
});
