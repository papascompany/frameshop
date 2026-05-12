# API Contract — Backend ↔ Frontend

> Frozen on 2026-05-12. Every entry below is a contract: backend-dev implements,
> frontend-dev consumes. Inputs and outputs are validated with the Zod schemas
> referenced in `shared/INTERFACES/types-frozen.md`.
>
> Server-only modules (anything reading `TOSS_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
> or executing state transitions) MUST `import 'server-only'` at the top of the
> file. Route Handlers live under `app/api/...` and never import client-only
> Konva code.

---

## Module: Catalog (M-Catalog)

### Server functions (`src/lib/db/catalog.ts`, server-only)
- `getCategories(): Promise<CategoryTreeNode[]>`
- `getProductsByCategory(slug: string, options?: ProductListQuery): Promise<ProductListResult>`
- `searchProducts(query: string): Promise<ProductListItem[]>`
- `getRepresentativeProducts(categoryIds: CategoryId[]): Promise<Record<string, ProductListItem | null>>` *(used by Landing)*

### Public pages
- `app/(shop)/page.tsx` (Server Component)
- `app/(shop)/catalog/[slug]/page.tsx` (Server Component)

---

## Module: Product Detail (M-ProductDetail)

### Server functions (`src/lib/db/product.ts`)
- `getProductDetail(id: ProductId): Promise<ProductDetail | null>`
- `getProductOptions(id: ProductId): Promise<OptionMatrix>`

### Client helpers (`src/lib/product/session.ts`)
- `startEditorSession(productId: ProductId): { sessionId: SessionId; redirectUrl: string }`

### Public pages
- `app/(shop)/product/[id]/page.tsx`

---

## Module: Photo (M-Photo)

### Route Handlers
- `POST /api/photos/upload` — body: multipart/form-data `{ file, sessionId? }`
  - **Auth:** optional (anon allowed; server reads session cookie or `sessionId`)
  - **Output:** `{ photo: Photo }`
  - **Errors:** 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_MIME`, 422 `EXIF_PARSE_FAILED`, 500 `UPLOAD_FAILED`

### Client helpers (`src/lib/photo/upload.ts`)
- `uploadPhoto(file: File, options?: UploadOptions): Promise<UploadResult>` — wraps fetch + canvas resize
- `parseExif(buffer: ArrayBuffer): ExifMeta` *(pure, UT-06)*

### Public components
- `<PhotoSourceSelector onSelect={(s: PhotoSource) => void} />`
- `<DevicePicker onPicked={(f: File) => void} />`
- `<PhotoGallery photos={Photo[]} onSelect={(p: Photo) => void} />`

---

## Module: Editor (M-FrameEditor + M-CropEditor)

### Pure helpers (`src/lib/konva/*`)
- `lookupVariant(params): ProductVariant | null`
- `applyCropTransform(image, transform): KonvaImageAttrs`
- `fitPhotoToFrame(photoSize, innerRect, stageSize): CropTransform`
- `generatePreviewBlob(stage): Promise<Blob>`

### Zustand store
- `useEditorStore` — state shape = `EditorState`
- Actions: `setColor`, `setSize`, `setMatte`, `setPaper`, `setPhoto`, `setCropTransform`, `generatePreview`, `reset`
- Selector: `useEditorPrice()`

### Public components
- `<FrameEditor product={ProductDetail} options={OptionMatrix} photo={Photo} onConfirm={(p: EditorConfirmPayload) => void} />`
  - **MUST** be imported via `dynamic(() => import('@/modules/editor/FrameEditor'), { ssr: false })`

### Pages
- `app/(shop)/studio/[orderId]/page.tsx`

---

## Module: Cart (M-Cart)

### Client API (`src/lib/cart/*`)
- `addToCart(item: AddToCartInput): Promise<CartItem>`
- `getCart(): Promise<CartItem[]>`
- `updateQuantity(localId: LocalId, quantity: number): Promise<void>`
- `removeFromCart(localId: LocalId): Promise<void>`
- `clearCart(localIds?: LocalId[]): Promise<void>`
- `syncCartOnLogin(userId: UserId): Promise<SyncResult>`
- `getCartSummary(items: CartItem[]): CartSummary` *(pure)*
- `serializeCartItem(item): string`, `deserializeCartItem(json): CartItem` *(pure, UT-07)*

### Route Handlers (authenticated users only)
- `GET /api/cart` → `CartItem[]`
- `POST /api/cart` → upsert by `(user_id, local_id)`
- `PATCH /api/cart/:localId` → `{ quantity }`
- `DELETE /api/cart/:localId`

### Pages
- `app/(shop)/cart/page.tsx`

---

## Module: Checkout (M-Checkout)

### Server functions (`src/lib/db/shipping.ts`)
- `getShippingMethods(): Promise<ShippingMethodConfig[]>` — active only, sorted
- `listShippingMethods(): Promise<ShippingMethodConfig[]>` *(admin: includes inactive)*

### Client helpers (`src/lib/checkout/*`)
- `validateCheckoutForm(data: CheckoutFormData): CheckoutValidation` *(UT-04)*
- `getPreviousShipping(userId: UserId): Promise<ShippingAddress | null>`
- `useCheckoutFormPersist(formId: string)` hook

### Pure helper (`src/lib/shipping/calc.ts`) — ADR-008, UT target
- `calculateShippingFee(method, subtotal, settings): number`
  - throws `InactiveShippingMethodError` on missing/inactive method.

### Public components
- `<CheckoutForm cartItems shippingMethods initialData? onSubmit />`
- `<PostcodeSearch onSelect={(r: PostcodeResult) => void} />`

### Pages
- `app/(shop)/checkout/page.tsx`

---

## Module: Payment (M-Payment)

### Client SDK
- `requestPayment(input: RequestPaymentInput): Promise<void>` (`src/lib/payment/client.ts`)
  - Triggers Toss SDK `tossPayments.requestPayment(...)`.

### Route Handlers (server-only)
- `POST /api/payment/confirm`
  - **Body:** `ConfirmPaymentInput`
  - **Output:** `ConfirmResult`
  - **Side effects:** Toss confirm API call → `transitionTo(orderId, 'PAID')`.
- `POST /api/webhook/payment`
  - **Headers:** `Toss-Signature`
  - **Body:** raw JSON (`WebhookEvent` after validation)
  - **Returns:** 200 OK once handled (idempotent on `paymentKey`).
  - **Errors:** 401 invalid signature, 422 schema mismatch.

### Internal helpers (server-only)
- `verifyWebhook(rawBody: string, signature: string): WebhookVerifyResult` *(UT-1st-priority)*
- `tossClient.confirm({...})`, `tossClient.cancel({...})`, `tossClient.getPayment(key)`

### Pages
- `app/(shop)/payment/success/page.tsx`
- `app/(shop)/payment/fail/page.tsx`
- `app/(shop)/order/success/page.tsx`

---

## Module: Order (M-Order)

### Server functions (`src/lib/db/order.ts`, **`'server-only'`**)
- `createOrder(input: CreateOrderInput): Promise<Order>`
- `transitionTo(orderId: OrderId, target: OrderStatus, meta?: TransitionMeta): Promise<Order>`
- `getOrder(orderNoOrId: string): Promise<OrderWithItems | null>` *(RLS enforced)*
- `findOrderByGuest(orderNo: OrderNo, phone: string): Promise<OrderWithItems | null>` *(service-role bypass)*
- `generateOrderNo(today: Date): Promise<OrderNo>` *(internal; UPSERT on `order_sequences`)*

### Pure helpers (`src/lib/order/state.ts`)
- `canTransition(from: OrderStatus, to: OrderStatus): boolean` *(UT-05)*

### Pages
- `app/(shop)/order/success/page.tsx`
- `app/(shop)/order/lookup/page.tsx` *(guest lookup)*
- `app/admin/orders/*`

---

## Module: Admin (M-Admin)

### Server actions (Next.js Server Actions, **admin-gated via middleware + RLS**)
- `upsertProduct(input: ProductFormInput): Promise<Product>`
- `toggleProductActive(id: ProductId, active: boolean): Promise<void>`
- `upsertFrameAsset(input: FrameAssetInput): Promise<FrameAsset>`
- `importVariants(productId: ProductId, rows: VariantInput[]): Promise<ImportReport>`
- `exportVariantsCsv(productId: ProductId): Promise<Blob>`
- `parseVariantCsv(file: File): Promise<{ rows: VariantInput[]; errors: VariantImportError[] }>` *(pure)*
- `upsertCuration(input: CurationInput): Promise<Curation>`
- `updateShippingMethod(code, payload: ShippingMethodInput): Promise<ShippingMethodConfig>` *(ADR-008)*
- `bulkUpdateShippingMethods(rows: ShippingMethodInput[]): Promise<ShippingMethodConfig[]>` *(ADR-008)*
- `downloadPrintFile(orderItemId: OrderItemId): Promise<string>` *(Phase 1 → preview URL)*

### Common
- `requireAdmin(): Promise<AdminUser>` — throws if non-admin.

### Pages
- `app/admin/{products,frames,options,orders,curation,shipping}/...`

---

## Module: Landing (M-Landing)

### Server functions (`src/lib/db/curation.ts`)
- `getActiveCurations(device: CurationDevice, now: Date): Promise<Curation[]>`
- `validateCurationPayload(type, payload): PayloadValidation<...>` *(uses `payloadSchemaFor`)*

### Pages
- `app/(shop)/page.tsx` (Server Component) renders `<HeroBanner>`, `<CategoryGrid>`, `<FeaturedCollection>`.

---

## Cross-cutting

### Supabase clients (`src/lib/supabase/*`)
- `getServerSupabase(cookies)` — SSR/route handler client, anon JWT scoped.
- `getBrowserSupabase()` — client component singleton.
- `getServiceRoleSupabase()` — **server-only**, RLS bypassed. Use for: webhook handlers, guest order creation, anon photo upload.

### Middleware
- `middleware.ts` enforces admin on `/admin/*` and `/api/admin/*` (also redirects unauthenticated users to `/login?redirect=...`).

### Error envelope (Route Handlers)
```ts
{ ok: false, code: string, message: string }
```

### Pagination envelope
Use `Paginated<T>` from `src/types/common.ts`.
