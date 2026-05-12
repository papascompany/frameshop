# Types — Frozen (Phase 2 / Architect)

> Single source of truth for every type that crosses module boundaries.
> Frozen on 2026-05-12. Any change requires an ADR in `shared/DECISIONS.md`.
> Implementation files: `src/types/*.ts`. Barrel: `import { … } from '@/types'`.

---

## Conventions

- **Strict TS** (`strict: true`). `noUncheckedIndexedAccess` recommended for new code.
- **Branded IDs.** All persistent IDs are `string & { __brand: 'X' }`. Use `asBrand<...>('uuid')` to cast at IO edges only.
- **Zod schemas live next to types** (`xxxSchema`). Use them at every IO boundary — Server Actions, Route Handlers, form submits, webhook payloads.
- **No `any`.** Use `unknown` + narrow.

## Branded IDs (src/types/common.ts)

| Type | Used in |
|---|---|
| `CategoryId` | categories |
| `ProductId` | products / product_images / frame_assets / variants / orders snapshots |
| `ProductImageId` | product_images |
| `FrameAssetId` | frame_assets |
| `ProductVariantId` | product_variants / cart_items / orders |
| `PhotoId` | photos / cart_items |
| `CartItemId` | cart_items |
| `OrderId` | orders / order_items / payment_events |
| `OrderItemId` | order_items |
| `CurationId` | curations |
| `ShippingMethodId` | shipping_methods |
| `PaymentEventId` | payment_events |
| `UserId` | auth.users |
| `LocalId` | client-side UUID for cart dedup |
| `SessionId` | editor / anonymous photo isolation |
| `OrderNo` | `YYYYMMDD-NNNN` |
| `PaymentKey` | Toss `paymentKey` |

Common helpers: `Result<T,E>`, `Paginated<T>`, `ListOptions`, `IsoTimestamp`,
`DEFAULT_PAGE_SIZE = 20`, `MAX_PAGE_SIZE = 100`.

---

## Product / Catalog (src/types/product.ts)

- `Category`, `CategoryTreeNode`
- `Product` (table row — **no thumbnail column**)
- `ProductListItem` = `Product & { thumbnail: string | null }` — what catalog/landing return
- `ProductImage`, `ProductImageType` = `'thumbnail' | 'gallery' | 'guide'`
- `FrameAsset`, `InnerRect`
- `ProductVariant`
- `MatteCode` = `'none' | 'with'`, `PaperCode` = `'glossy' | 'matte' | 'fineart'`
- `ProductDetail`, `OptionMatrix`, `SelectedOptions`, `variantKey()`
- `ProductListQuery`, `ProductListResult`, `ProductSort` = `'default'|'priceAsc'|'priceDesc'|'newest'`

Zod: `innerRectSchema`, `matteCodeSchema`, `paperCodeSchema`, `productImageTypeSchema`, `selectedOptionsSchema`, `productListQuerySchema`.

---

## Photo (src/types/photo.ts)

- `Photo`, `ExifMeta`, `ExifOrientation = 1|…|8`
- `PhotoSource = 'device' | 'cloud' | 'stock'`
- `UploadOptions`, `UploadResult`, `PhotoUploadError` (class) + `UploadErrorCode`
- Constants: `MAX_UPLOAD_BYTES = 50MB`, `LONG_EDGE_RESIZE_PX = 1600`, `THUMB_LONG_EDGE_PX = 400`, `ALLOWED_PHOTO_MIME`

---

## Editor (src/types/editor.ts)

- `CropTransform = { x, y, scale, rotation }`
- `EditorState` — note `productId: ProductId | null` (null before init; ADR-014 drift resolved 2026-05-12 / P2-02)
- `EditorConfirmPayload`
- Constants: `CROP_SCALE_MIN = 0.5`, `CROP_SCALE_MAX = 3.0`, `CROP_ROTATION_MIN_DEG = -45`, `CROP_ROTATION_MAX_DEG = 45`, `PREVIEW_PIXEL_RATIO = 2`, `DEFAULT_INNER_RECT_FALLBACK = {x:0.1,y:0.1,w:0.8,h:0.8}`

This file is **Konva-free** and importable on both server and client. The
runtime Konva component must use `dynamic(() => import(...), { ssr: false })`.

---

## Cart (src/types/cart.ts)

- `CartItem` — includes optional server `id` + required `localId` (LocalStorage/DB dedup key)
- `CartSummary`, `AddToCartInput`, `SyncResult`
- Constants: `CART_LOCAL_STORAGE_KEY = 'frameshop.cart.v1'`, `CART_QUANTITY_MIN/MAX`

---

## Shipping (src/types/shipping.ts)  — ADR-008

- `ShippingMethod = 'STANDARD' | 'PICKUP' | 'QUICK'`
- `ShippingMethodConfig`, `ShippingMethodInput`
- `CalculateShippingFee` function-type (pure, throws `InactiveShippingMethodError`)
- `bulkShippingMethodInputSchema` requires ≥1 active row.

---

## Order (src/types/order.ts)

- `OrderStatus` union (7 states) + `ORDER_STATUSES` const tuple
- `ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]>` — the state-machine table
- `InvalidStateTransitionError` (class)
- `Orderer`, `ShippingAddress`
- `Order` (now includes `shippingMethod`, `shippingFee` snapshots — ADR-008)
- `OrderItem`, `OrderItemSnapshot`, `OrderWithItems`
- `CreateOrderInput`, `CreateOrderError` + `CreateOrderErrorCode`
- `TransitionMeta`

---

## Checkout (src/types/checkout.ts)

- `CheckoutFormData` (orderer + shipping[with `sameAsOrderer`] + shippingMethod)
- `CheckoutValidation`, `PostcodeResult`
- `checkoutFormSchema` — Zod schema with `superRefine` that exempts PICKUP from zip/addr1.

---

## Payment (src/types/payment.ts)

- `RequestPaymentInput`, `ConfirmPaymentInput`, `ConfirmResult` (discriminated)
- `WebhookEvent`, `WebhookVerifyResult`
- `TossPaymentStatus` union + `TOSS_STATUS_TO_ORDER_STATUS` mapping
- `PaymentEvent` (DB row)
- Constants: `MAX_PAYMENT_CONFIRM_TIMEOUT_MS = 10_000`, `MAX_PAYMENT_RETRY_SECONDS = 600`

Server-only modules must `import 'server-only'` for confirm/webhook code paths.

---

## Curation (src/types/curation.ts) — ADR-007

- `CurationType = 'banner' | 'collection' | 'feature'`
- `CurationDevice = 'all' | 'pc' | 'mobile'`
- `Curation` (payload is `unknown` at the table level; validate via `payloadSchemaFor(type)`)
- Payload types: `BannerPayload`, `CollectionPayload`, `FeaturePayload`
- Discriminated `CurationPayload`

---

## Admin (src/types/admin.ts)

- `AdminUser`, `AdminRole = 'admin'`
- `ProductFormInput`, `ProductFormImages`, `ProductImageInput`
- `FrameAssetInput`, `frameAssetInputSchema`
- `VariantInput`, `VariantImportError`, `ImportReport`, `variantInputSchema`
- `CurationInput`, `curationInputSchema`
- `OrderListFilter`

---

## Landing (src/types/landing.ts)

- `LandingData`, `LandingDeviceQuery`
- `ResolvedHeroBanner`, `ResolvedFeaturedCollection`

---

## DB schema → type mapping

| Table | Primary type |
|---|---|
| `categories` | `Category` (snake_case ↔ camelCase mapper in `src/lib/db/*`) |
| `products` | `Product` |
| `product_images` | `ProductImage` |
| `frame_assets` | `FrameAsset` |
| `product_variants` | `ProductVariant` |
| `photos` | `Photo` |
| `cart_items` | `CartItem` |
| `orders` | `Order` |
| `order_items` | `OrderItem` (`variant_snapshot` jsonb → `OrderItemSnapshot`) |
| `order_sequences` | (internal — order_no generation) |
| `payment_events` | `PaymentEvent` |
| `curations` | `Curation` |
| `shipping_methods` | `ShippingMethodConfig` |

---

## Verification

- `npm run typecheck` ✅ passes (2026-05-12, post-Architect).
