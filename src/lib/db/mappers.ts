/**
 * snake_case (Postgres row) → camelCase (domain type) mappers.
 *
 * These are the single chokepoints where we cast `string` → branded IDs.
 * If a row shape changes, update the mapper here, not at every call site.
 */

import { asBrand } from '@/types/common';
import type {
  CategoryId,
  CurationId,
  FrameAssetId,
  OrderId,
  OrderItemId,
  PaymentEventId,
  PhotoId,
  ProductId,
  ProductImageId,
  ProductVariantId,
  ShippingMethodId,
  UserId,
} from '@/types/common';
import type {
  Category,
  FrameAsset,
  InnerRect,
  MatteCode,
  PaperCode,
  Product,
  ProductImage,
  ProductImageType,
  ProductListItem,
  ProductVariant,
} from '@/types/product';
import type { Photo, ExifMeta } from '@/types/photo';
import type { CartItem } from '@/types/cart';
import type {
  Order,
  OrderItem,
  OrderItemSnapshot,
  OrderStatus,
  Orderer,
  ShippingAddress,
} from '@/types/order';
import type { ShippingMethodConfig } from '@/types/shipping';
import type { ShippingMethod } from '@/types/shipping';
import type { Curation, CurationType, CurationDevice } from '@/types/curation';
import type { PaymentEvent, TossPaymentStatus } from '@/types/payment';
import type { CropTransform } from '@/types/editor';

// ---------- Generic row shapes (db side) ----------

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
};

type ProductRow = {
  id: string;
  category_id: string;
  name: string;
  tagline: string;
  description: string;
  base_price: number;
  has_frame: boolean;
  is_active: boolean;
  sort_order: number;
  /** numeric column — Supabase returns it as number or string depending on driver. */
  bleed_mm?: number | string | null;
  created_at: string;
};

type ProductImageRow = {
  id: string;
  product_id: string;
  image_url: string;
  alt_text: string | null;
  type: string;
  sort_order: number;
};

type FrameAssetRow = {
  id: string;
  product_id: string;
  color_code: string;
  color_label: string;
  png_url: string;
  inner_rect: InnerRect;
  preview_url: string | null;
};

type ProductVariantRow = {
  id: string;
  product_id: string;
  size_code: string;
  size_label: string;
  width_mm: number;
  height_mm: number;
  color_code: string;
  matte_code: string;
  paper_code: string;
  price: number;
  stock: number;
  is_active: boolean;
};

type PhotoRow = {
  id: string;
  user_id: string | null;
  session_id: string | null;
  original_url: string;
  thumb_url: string;
  width_px: number | null;
  height_px: number | null;
  exif: ExifMeta | null;
  created_at: string;
};

type CartItemRow = {
  id: string;
  local_id: string;
  user_id: string;
  variant_id: string;
  photo_id: string;
  options: CartItem['options'];
  photo_url: string;
  crop_transform: CropTransform;
  preview_url: string;
  price: number;
  quantity: number;
  created_at: string;
};

type OrderRow = {
  id: string;
  order_no: string;
  user_id: string | null;
  status: string;
  total_price: number;
  shipping_fee: number;
  shipping_method: string;
  payment_id: string | null;
  tracking_number: string | null;
  courier: string | null;
  orderer: Orderer;
  shipping: ShippingAddress;
  /** migration 029 — may be absent on rows from before it was applied. */
  order_memo?: string | null;
  created_at: string;
  paid_at: string | null;
  shipped_at: string | null;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  variant_snapshot: OrderItemSnapshot;
  photo_url: string;
  crop_transform: CropTransform;
  print_file_url: string | null;
  quantity: number;
  price: number;
};

type ShippingMethodRow = {
  id: string;
  code: string;
  label: string;
  fee: number;
  free_threshold: number | null;
  note: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type CurationRow = {
  id: string;
  type: string;
  title: string | null;
  payload: unknown;
  device: string;
  start_at: string | null;
  end_at: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

type PaymentEventRow = {
  id: string;
  payment_key: string;
  order_id: string | null;
  order_no: string;
  status: string;
  raw_payload: unknown;
  received_at: string;
};

// ---------- Mappers ----------

export const mapCategory = (row: CategoryRow): Category => ({
  id: asBrand<CategoryId>(row.id),
  slug: row.slug,
  name: row.name,
  parentId: row.parent_id ? asBrand<CategoryId>(row.parent_id) : null,
  sortOrder: row.sort_order,
  isActive: row.is_active,
});

export const mapProduct = (row: ProductRow): Product => ({
  id: asBrand<ProductId>(row.id),
  categoryId: asBrand<CategoryId>(row.category_id),
  name: row.name,
  tagline: row.tagline,
  description: row.description,
  basePrice: row.base_price,
  hasFrame: row.has_frame,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  bleedMm: row.bleed_mm == null ? 0 : Number(row.bleed_mm),
  createdAt: row.created_at,
});

export const mapProductListItem = (
  row: ProductRow & { thumbnail: string | null },
): ProductListItem => ({
  ...mapProduct(row),
  thumbnail: row.thumbnail,
});

export const mapProductImage = (row: ProductImageRow): ProductImage => ({
  id: asBrand<ProductImageId>(row.id),
  productId: asBrand<ProductId>(row.product_id),
  imageUrl: row.image_url,
  altText: row.alt_text,
  type: row.type as ProductImageType,
  sortOrder: row.sort_order,
});

export const mapFrameAsset = (row: FrameAssetRow): FrameAsset => ({
  id: asBrand<FrameAssetId>(row.id),
  productId: asBrand<ProductId>(row.product_id),
  colorCode: row.color_code,
  colorLabel: row.color_label,
  pngUrl: row.png_url,
  innerRect: row.inner_rect,
  previewUrl: row.preview_url,
});

export const mapVariant = (row: ProductVariantRow): ProductVariant => ({
  id: asBrand<ProductVariantId>(row.id),
  productId: asBrand<ProductId>(row.product_id),
  sizeCode: row.size_code,
  sizeLabel: row.size_label,
  widthMm: row.width_mm,
  heightMm: row.height_mm,
  colorCode: row.color_code,
  matteCode: row.matte_code as MatteCode,
  paperCode: row.paper_code as PaperCode,
  price: row.price,
  stock: row.stock,
  isActive: row.is_active,
});

export const mapPhoto = (row: PhotoRow): Photo => ({
  id: asBrand<PhotoId>(row.id),
  userId: row.user_id ? asBrand<UserId>(row.user_id) : null,
  sessionId: row.session_id
    ? asBrand<ReturnType<typeof asBrand<import('@/types/common').SessionId>>>(row.session_id)
    : null,
  originalUrl: row.original_url,
  thumbUrl: row.thumb_url,
  widthPx: row.width_px,
  heightPx: row.height_px,
  exif: row.exif,
  createdAt: row.created_at,
});

export const mapCartItem = (row: CartItemRow): CartItem => ({
  id: asBrand<import('@/types/common').CartItemId>(row.id),
  localId: asBrand<import('@/types/common').LocalId>(row.local_id),
  userId: asBrand<UserId>(row.user_id),
  productId: asBrand<ProductId>(''), // filled by db query via join — see db/cart.ts
  variantId: asBrand<ProductVariantId>(row.variant_id),
  photoId: asBrand<PhotoId>(row.photo_id),
  options: row.options,
  photoUrl: row.photo_url,
  cropTransform: row.crop_transform,
  previewUrl: row.preview_url,
  price: row.price,
  quantity: row.quantity,
  createdAt: row.created_at,
});

export const mapOrder = (row: OrderRow): Order => ({
  id: asBrand<OrderId>(row.id),
  orderNo: asBrand<import('@/types/common').OrderNo>(row.order_no),
  userId: row.user_id ? asBrand<UserId>(row.user_id) : null,
  status: row.status as OrderStatus,
  totalPrice: row.total_price,
  shippingFee: row.shipping_fee,
  shippingMethod: row.shipping_method as ShippingMethod,
  paymentId: row.payment_id
    ? asBrand<import('@/types/common').PaymentKey>(row.payment_id)
    : null,
  trackingNumber: row.tracking_number,
  courier: row.courier,
  orderer: row.orderer,
  shipping: row.shipping,
  // undefined-safe: column may not exist yet (migration 029 unapplied).
  orderMemo: row.order_memo ?? null,
  createdAt: row.created_at,
  paidAt: row.paid_at,
  shippedAt: row.shipped_at,
});

export const mapOrderItem = (row: OrderItemRow): OrderItem => ({
  id: asBrand<OrderItemId>(row.id),
  orderId: asBrand<OrderId>(row.order_id),
  snapshot: row.variant_snapshot,
  photoUrl: row.photo_url,
  cropTransform: row.crop_transform,
  printFileUrl: row.print_file_url,
  quantity: row.quantity,
  price: row.price,
});

export const mapShippingMethod = (row: ShippingMethodRow): ShippingMethodConfig => ({
  id: asBrand<ShippingMethodId>(row.id),
  code: row.code as ShippingMethod,
  label: row.label,
  fee: row.fee,
  freeThreshold: row.free_threshold,
  note: row.note,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapCuration = (row: CurationRow): Curation => ({
  id: asBrand<CurationId>(row.id),
  type: row.type as CurationType,
  title: row.title,
  payload: row.payload,
  device: row.device as CurationDevice,
  startAt: row.start_at,
  endAt: row.end_at,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
});

export const mapPaymentEvent = (row: PaymentEventRow): PaymentEvent => ({
  id: asBrand<PaymentEventId>(row.id),
  paymentKey: asBrand<import('@/types/common').PaymentKey>(row.payment_key),
  orderId: row.order_id ? asBrand<OrderId>(row.order_id) : null,
  orderNo: asBrand<import('@/types/common').OrderNo>(row.order_no),
  status: row.status as TossPaymentStatus,
  rawPayload: row.raw_payload,
  receivedAt: row.received_at,
});
