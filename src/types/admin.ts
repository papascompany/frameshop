/**
 * Admin (back-office) types.
 *
 * Sources: docs/specs/admin.md.
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import { z } from 'zod';
import { httpsUrl } from '../lib/validation/url';
import { matteCodeSchema, paperCodeSchema, productTypeSchema } from './product';
import {
  curationDeviceSchema,
  curationTypeSchema,
} from './curation';
import type {
  CategoryId,
  IsoTimestamp,
  ProductId,
  UserId,
} from './common';
import type { ProductImageType, ProductType } from './product';
import type { CurationPayload } from './curation';

// ---------- Admin auth ----------

export type AdminRole = 'admin';

export type AdminUser = {
  id: UserId;
  email: string;
  role: AdminRole;
};

// ---------- Product admin inputs ----------

export type ProductFormInput = {
  name: string;
  categoryId: CategoryId;
  tagline: string;
  description: string;
  basePrice: number;
  hasFrame: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Print bleed in mm added around inner_rect when generating the print crop. */
  bleedMm: number;
  /**
   * 확장형 분기축(ADR-026, FS-X-03 — FROZEN 옵셔널 추가). 미지정 = upsertProduct 가
   * product_type 컬럼을 건드리지 않음(INSERT 는 DB DEFAULT 'single', UPDATE 는 기존값
   * 유지). 명시 지정 = single→extended 승격(비파괴 update) 경로.
   */
  productType?: ProductType;
};

/** File-bearing input used by the form-data path. */
export type ProductFormImages = {
  thumbnail?: File;
  gallery: File[];
  guide: File[];
};

/** What gets persisted on `product_images` after Storage upload. */
export type ProductImageInput = {
  productId: ProductId;
  imageUrl: string;
  altText: string | null;
  type: ProductImageType;
  sortOrder: number;
};

export const productFormSchema = z.object({
  name: z.string().min(1).max(80),
  categoryId: z.string().min(1),
  tagline: z.string().max(120),
  description: z.string().max(50_000),
  basePrice: z.number().int().nonnegative(),
  hasFrame: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  bleedMm: z.number().min(0).max(50),
  // ADR-026 (FS-X-03): 옵셔널 추가만 — 기존 폼 payload 는 그대로 통과한다.
  productType: productTypeSchema.optional(),
});

// ---------- Category admin inputs ----------

export type CategoryFormInput = {
  slug: string;
  name: string;
  parentId: CategoryId | null;
  sortOrder: number;
  isActive: boolean;
};

export const categoryFormSchema = z.object({
  // URL segment (/catalog/<slug>) — lowercase alphanumeric + dashes only.
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '소문자/숫자/하이픈만 사용하세요 (예: premium-frame)'),
  name: z.string().min(1).max(40),
  parentId: z.string().min(1).nullable(),
  sortOrder: z.number().int().nonnegative(),
  isActive: z.boolean(),
});

// ---------- Frame admin inputs ----------

export type FrameAssetInput = {
  productId: ProductId;
  colorCode: string;
  colorLabel: string;
  /** Storage URL after upload. */
  pngUrl: string;
  innerRect: { x: number; y: number; w: number; h: number };
  previewUrl: string | null;
};

export const frameAssetInputSchema = z.object({
  productId: z.string().min(1),
  colorCode: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, 'lowercase alphanumeric + `_`/`-`'),
  colorLabel: z.string().min(1).max(40),
  // Frame asset URLs are written to next/image src and rendered as
  // backgrounds — block non-https schemes (ADR-016, P1-07).
  pngUrl: httpsUrl(),
  innerRect: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.01).max(1),
    h: z.number().min(0.01).max(1),
  }),
  previewUrl: httpsUrl().nullable(),
});

// ---------- Variant CSV import ----------

export type VariantInput = {
  productId: ProductId;
  sizeCode: string;
  sizeLabel: string;
  widthMm: number;
  heightMm: number;
  colorCode: string;
  matteCode: 'none' | 'with';
  paperCode: 'glossy' | 'matte' | 'fineart';
  price: number;
  stock: number;
  isActive: boolean;
};

export type VariantImportError = {
  row: number;
  field: string;
  message: string;
};

export type ImportReport = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: VariantImportError[];
};

export const variantInputSchema = z.object({
  productId: z.string().min(1),
  sizeCode: z.string().min(1).max(40),
  sizeLabel: z.string().min(1).max(40),
  widthMm: z.number().int().positive(),
  heightMm: z.number().int().positive(),
  colorCode: z.string().min(1).max(40),
  matteCode: matteCodeSchema,
  paperCode: paperCodeSchema,
  price: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  isActive: z.boolean(),
});

// ---------- Curation admin input ----------

export type CurationInput = {
  type: CurationPayload['type'];
  title: string | null;
  payload: CurationPayload;
  device: 'all' | 'pc' | 'mobile';
  startAt: IsoTimestamp | null;
  endAt: IsoTimestamp | null;
  isActive: boolean;
  sortOrder: number;
};

export const curationInputSchema = z.object({
  type: curationTypeSchema,
  title: z.string().max(80).nullable(),
  payload: z.unknown(), // verified separately by payloadSchemaFor()
  device: curationDeviceSchema,
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
});

// ---------- Order admin list query ----------

export type OrderListFilter = {
  status?:
    | 'CREATED'
    | 'PAID'
    | 'IN_PRODUCTION'
    | 'SHIPPED'
    | 'DELIVERED'
    | 'CANCELLED'
    | 'REFUNDED';
  page?: number;
  pageSize?: number;
};
