/**
 * Order persistence and state-machine side effects (M-Order).
 *
 * Server-only. transitionTo / createOrder must never run on the client.
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { OrderId, OrderNo, PaymentKey, UserId } from '@/types/common';
import {
  CreateOrderError,
  type CreateOrderInput,
  InvalidStateTransitionError,
  type Order,
  type OrderItem,
  type OrderItemSnapshot,
  type OrderStatus,
  type OrderWithItems,
  type TransitionMeta,
} from '@/types/order';
import { mapOrder, mapOrderItem } from './mappers';
import { canTransition, formatOrderNo } from '../order/state';
import { calculateShippingFee } from '../shipping/calc';
import { getShippingMethods } from './shipping';
import { getServiceRoleSupabase } from '../supabase/service';
import { tossClient } from '../payment/toss';
import { notifyCancelled } from '../notify';

// ---------- generateOrderNo (atomic RPC) ----------

export async function generateOrderNo(today: Date): Promise<OrderNo> {
  const supabase = getServiceRoleSupabase();

  // Compute KST day (YYYY-MM-DD).
  const kst = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.toISOString().slice(0, 10);

  // Atomic via SECURITY DEFINER function `next_order_no` (migration 014).
  // The function wraps INSERT ... ON CONFLICT DO UPDATE ... RETURNING seq
  // in a single statement, so concurrent calls cannot collide on the
  // same (day, seq) — race window eliminated. See ADR-019.
  const { data: nextSeq, error: rpcErr } = await supabase.rpc(
    'next_order_no',
    { day_kst: day },
  );

  if (rpcErr || typeof nextSeq !== 'number') {
    throw new CreateOrderError(
      'SEQUENCE_FAILED',
      rpcErr?.message ?? 'next_order_no returned non-numeric result',
    );
  }
  return asBrand<OrderNo>(formatOrderNo(today, nextSeq));
}

// ---------- createOrder ----------

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  if (input.cartItems.length === 0) {
    throw new CreateOrderError('EMPTY_CART');
  }

  // Validate variant activity + price (one round trip).
  // DB is authoritative: client-sent price is never trusted (P0-01 fix).
  const supabase = getServiceRoleSupabase();
  const variantIds = input.cartItems.map((i) => i.variantId as string);
  const { data: variants, error: vErr } = await supabase
    .from('product_variants')
    .select(
      'id, is_active, price, product_id, size_label, color_label, color_code, products(name, bleed_mm)',
    )
    .in('id', variantIds);
  if (vErr) {
    throw new CreateOrderError('INVALID_VARIANT', vErr.message);
  }
  type ProductJoin = { name: string; bleed_mm: number | string | null };
  type VariantWithProduct = {
    id: string;
    is_active: boolean;
    price: number;
    product_id: string;
    size_label: string;
    color_label: string;
    color_code: string;
    products: ProductJoin | ProductJoin[] | null;
  };
  const variantById = new Map(
    ((variants ?? []) as VariantWithProduct[]).map((v) => [v.id, v]),
  );
  for (const item of input.cartItems) {
    const v = variantById.get(item.variantId as string);
    if (!v || !v.is_active) {
      throw new CreateOrderError('INVALID_VARIANT', `Variant ${item.variantId} inactive`);
    }
    // Refuse if client-side price disagrees with DB. Prevents `price: 1` attack.
    if (v.price !== item.price) {
      throw new CreateOrderError(
        'PRICE_MISMATCH',
        `variant=${item.variantId} client=${item.price} server=${v.price}`,
      );
    }
  }

  // Subtotal from DB price (server-authoritative, not from client cart).
  const subtotal = input.cartItems.reduce((acc, item) => {
    const v = variantById.get(item.variantId as string)!;
    return acc + v.price * item.quantity;
  }, 0);

  // Server-authoritative shipping fee.
  const settings = await getShippingMethods();
  const shippingFee = calculateShippingFee(
    input.shippingMethod,
    subtotal,
    settings,
  );

  if (
    typeof input.clientShippingFee === 'number' &&
    input.clientShippingFee !== shippingFee
  ) {
    throw new CreateOrderError(
      'SHIPPING_FEE_MISMATCH',
      `client=${input.clientShippingFee} server=${shippingFee}`,
    );
  }

  const totalPrice = subtotal + shippingFee;

  // P0-03: Verify photo ownership BEFORE writing any rows.
  // Prevents User A from referencing User B's photo URL in their order, which
  // would otherwise expose B's private photo in A's render output.
  const photoUrls = input.cartItems.map((i) => i.photoUrl).filter(Boolean);
  if (photoUrls.length > 0) {
    const { data: ownedPhotos } = await supabase
      .from('photos')
      .select('original_url, user_id, session_id')
      .in('original_url', photoUrls);

    const ownedSet = new Set<string>();
    for (const p of ownedPhotos ?? []) {
      const row = p as { original_url: string; user_id: string | null; session_id: string | null };
      const callerOwns =
        (input.userId != null && row.user_id === (input.userId as string)) ||
        (input.userId == null && input.sessionId != null && row.session_id === input.sessionId);
      if (callerOwns) {
        ownedSet.add(row.original_url);
      }
    }

    const unowned = photoUrls.filter((u) => !ownedSet.has(u));
    if (unowned.length > 0) {
      throw new CreateOrderError(
        'PHOTO_OWNERSHIP',
        `Photo(s) not owned by caller: ${unowned.join(', ')}`,
      );
    }
  }

  const orderNo = await generateOrderNo(new Date());

  const { data: orderRow, error: insErr } = await supabase
    .from('orders')
    .insert({
      order_no: orderNo as string,
      user_id: (input.userId ?? null) as UserId | null,
      status: 'CREATED',
      total_price: totalPrice,
      shipping_fee: shippingFee,
      shipping_method: input.shippingMethod,
      orderer: input.orderer,
      shipping: input.shipping,
    })
    .select()
    .single();

  if (insErr || !orderRow) {
    throw new CreateOrderError(
      'SEQUENCE_FAILED',
      insErr?.message ?? 'orders insert failed',
    );
  }

  const order = mapOrder(orderRow);

  // Look up the frame_asset that matches each cart item's (product, color)
  // so the render pipeline (frame_skills §5) can resolve it deterministically
  // even if admins later add/remove colors. Single round trip across all
  // distinct products in the cart.
  const productIds = Array.from(
    new Set(
      input.cartItems
        .map((i) => variantById.get(i.variantId as string)?.product_id)
        .filter((p): p is string => typeof p === 'string'),
    ),
  );
  const { data: frameRows } = await supabase
    .from('frame_assets')
    .select('id, product_id, color_code')
    .in('product_id', productIds);
  const frameByKey = new Map<string, string>();
  for (const f of (frameRows ?? []) as Array<{ id: string; product_id: string; color_code: string }>) {
    frameByKey.set(`${f.product_id}|${f.color_code}`, f.id);
  }

  // order_items snapshot insert. All authoritative fields come from DB so
  // the snapshot survives later price/label edits in admin.
  const itemRows = input.cartItems.map((item) => {
    const v = variantById.get(item.variantId as string)!;
    // Supabase join returns object (one-to-one) or array depending on schema.
    const product = Array.isArray(v.products) ? v.products[0] : v.products;
    const productName = product?.name ?? '';
    // Freeze the per-product bleed so the render reproduces the baked crop's
    // exact size even if admin later edits products.bleed_mm.
    const rawBleed = product?.bleed_mm;
    const bleedNum = typeof rawBleed === 'string' ? Number(rawBleed) : rawBleed;
    const bleedMm =
      typeof bleedNum === 'number' && Number.isFinite(bleedNum) && bleedNum >= 0
        ? bleedNum
        : 0;
    const snapshot: OrderItemSnapshot = {
      productId: item.productId,
      variantId: item.variantId,
      productName,
      options: item.options,
      sizeLabel: v.size_label,
      colorLabel: v.color_label,
      unitPrice: v.price,
      bleedMm,
      // 선결과제 1: freeze the ORIGINAL photo reference so reorder/re-edit can
      // reconstruct the line. `item.photoUrl` (→ order_items.photo_url) stays the
      // baked crop for print; this is provenance only, unused by the render path.
      sourcePhotoId: item.photoId,
    };
    const frameAssetId = frameByKey.get(`${v.product_id}|${v.color_code}`) ?? null;
    return {
      order_id: order.id as string,
      variant_snapshot: snapshot,
      photo_url: item.photoUrl,
      crop_transform: item.cropTransform,
      print_file_url: null,
      // Render-pipeline meta (migration 015). `stage_size` is not part of the
      // frozen CartItem contract yet — left NULL; the pipeline derives a
      // fallback from variant aspect ratio. `frame_asset_id` is resolved from
      // (product, color) above.
      frame_asset_id: frameAssetId,
      stage_size: null,
      quantity: item.quantity,
      price: v.price,
    };
  });

  const { error: oiErr } = await supabase.from('order_items').insert(itemRows);
  if (oiErr) {
    throw new CreateOrderError('SEQUENCE_FAILED', oiErr.message);
  }

  return order;
}

// ---------- transitionTo ----------

export async function transitionTo(
  orderId: OrderId,
  target: OrderStatus,
  meta: TransitionMeta = {},
): Promise<Order> {
  const supabase = getServiceRoleSupabase();

  const { data: current, error: fetchErr } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId as string)
    .single();
  if (fetchErr || !current) {
    throw new Error(`transitionTo: order ${orderId} not found`);
  }

  const currentStatus = current.status as OrderStatus;

  if (!canTransition(currentStatus, target)) {
    throw new InvalidStateTransitionError(currentStatus, target);
  }
  if (currentStatus === target) {
    return mapOrder(current);
  }

  const patch: Record<string, unknown> = { status: target };
  if (target === 'PAID') {
    patch.paid_at = new Date().toISOString();
    if (meta.paymentKey) patch.payment_id = meta.paymentKey as string;
  } else if (target === 'SHIPPED') {
    patch.shipped_at = new Date().toISOString();
    if (meta.trackingNumber) patch.tracking_number = meta.trackingNumber;
    if (meta.courier) patch.courier = meta.courier;
  }

  const { data: updated, error: updErr } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', orderId as string)
    .select()
    .single();

  if (updErr || !updated) {
    throw new Error(`transitionTo update failed: ${updErr?.message}`);
  }
  return mapOrder(updated);
}

// ---------- getOrder / findOrderByGuest ----------

export async function getOrder(
  orderNoOrId: string,
): Promise<OrderWithItems | null> {
  const supabase = getServiceRoleSupabase();
  const column = /^\d{8}-\d{4}$/.test(orderNoOrId) ? 'order_no' : 'id';
  const { data: orderRow, error } = await supabase
    .from('orders')
    .select('*')
    .eq(column, orderNoOrId)
    .maybeSingle();
  if (error) throw new Error(`getOrder: ${error.message}`);
  if (!orderRow) return null;

  const { data: itemRows } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderRow.id as string);
  const items: OrderItem[] = (itemRows ?? []).map(mapOrderItem);

  return { ...mapOrder(orderRow), items };
}

export async function findOrderByGuest(
  orderNo: OrderNo,
  phone: string,
): Promise<OrderWithItems | null> {
  const result = await getOrder(orderNo as string);
  if (!result) return null;
  if (result.orderer.phone !== phone) return null;
  return result;
}

/**
 * Link guest orders (user_id IS NULL) placed with the given email to a now
 * authenticated account, so they appear under /account/orders.
 *
 * SAFETY: only call this with an email the caller has just authenticated as
 * (e.g. right after a successful sign-in). The orderer email was entered at
 * checkout; matching it to the logged-in user's verified email is the link key.
 * Returns the number of orders claimed. Best-effort — never throws.
 */
export async function claimGuestOrdersByEmail(
  userId: UserId,
  email: string,
): Promise<number> {
  try {
    const supabase = getServiceRoleSupabase();
    const { data, error } = await supabase
      .from('orders')
      .update({ user_id: userId as string })
      .is('user_id', null)
      .eq('orderer->>email', email)
      .select('id');
    if (error) {
      console.warn(`claimGuestOrdersByEmail: ${error.message}`);
      return 0;
    }
    return (data ?? []).length;
  } catch (err) {
    console.warn('claimGuestOrdersByEmail threw:', err);
    return 0;
  }
}

// ---------- getOrdersByUser ----------

/**
 * 로그인 사용자의 주문 목록 조회 (최근 50건, created_at DESC).
 * order_items를 조인하여 OrderWithItems 배열 반환.
 */
export async function getOrdersByUser(userId: UserId): Promise<OrderWithItems[]> {
  const supabase = getServiceRoleSupabase();

  const { data: orderRows, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId as string)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`getOrdersByUser: ${error.message}`);
  if (!orderRows || orderRows.length === 0) return [];

  const orderIds = orderRows.map((r) => (r as { id: string }).id);

  const { data: itemRows, error: itemErr } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds);

  if (itemErr) throw new Error(`getOrdersByUser items: ${itemErr.message}`);

  const itemsByOrderId = new Map<string, OrderItem[]>();
  for (const row of itemRows ?? []) {
    const r = row as { order_id: string };
    const existing = itemsByOrderId.get(r.order_id) ?? [];
    existing.push(mapOrderItem(row));
    itemsByOrderId.set(r.order_id, existing);
  }

  return orderRows.map((row) => {
    const r = row as { id: string };
    const order = mapOrder(row);
    const items = itemsByOrderId.get(r.id) ?? [];
    return { ...order, items };
  });
}

// ---------- order list filters (admin) ----------

/** Shared search/date filter args for the admin order list + CSV export. */
type OrderListFilters = {
  status?: OrderStatus | null;
  /** Free-text: matches order_no OR orderer name/phone/email (case-insensitive). */
  q?: string | null;
  /** ISO date/datetime — created_at >= from (inclusive) when set. */
  from?: string | null;
  /** ISO date/datetime — created_at <= to (inclusive) when set. */
  to?: string | null;
};

/**
 * Escape a user search term for safe use inside a PostgREST `.or()` filter
 * string. PostgREST splits `.or()` on commas and treats `*`/`%` as wildcards;
 * an unescaped comma would let a search box inject extra OR predicates, and a
 * `*` would broaden the match unexpectedly. We strip the structural chars and
 * wrap the remainder in `*…*` for a contains-style ILIKE.
 *
 * Returns null when nothing meaningful is left, so the caller can skip the
 * filter entirely rather than matching `**` (everything).
 */
function buildOrSearchPattern(raw: string): string | null {
  // Drop characters that have meaning in the PostgREST filter grammar so the
  // term is treated as a literal substring, never as filter structure.
  const cleaned = raw.replace(/[,()%*\\]/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return `*${cleaned}*`;
}

/**
 * Apply status/q/from/to filters to an `orders` query builder. Mutates nothing;
 * returns the new builder. Shared by getAllOrdersPaged and getOrdersForExport so
 * the paginated list and the CSV export always agree on what matches.
 *
 * `orderer` is a JSONB column ({ name, phone, email }); we match its fields with
 * the `orderer->>field.ilike.*term*` PostgREST path syntax inside `.or()`.
 */
function applyOrderFilters<
  Q extends {
    eq(col: string, val: string): Q;
    or(filter: string): Q;
    gte(col: string, val: string): Q;
    lte(col: string, val: string): Q;
  },
>(query: Q, filters: OrderListFilters): Q {
  let q = query;
  if (filters.status) {
    q = q.eq('status', filters.status);
  }
  if (filters.q) {
    const pattern = buildOrSearchPattern(filters.q);
    if (pattern) {
      q = q.or(
        [
          `order_no.ilike.${pattern}`,
          `orderer->>name.ilike.${pattern}`,
          `orderer->>phone.ilike.${pattern}`,
          `orderer->>email.ilike.${pattern}`,
        ].join(','),
      );
    }
  }
  if (filters.from) {
    q = q.gte('created_at', filters.from);
  }
  if (filters.to) {
    // A date-only `to` (YYYY-MM-DD) compared against a timestamp would resolve to
    // 00:00:00 and exclude the whole end day. Extend it to end-of-day so the
    // selected end date is inclusive.
    const to = /^\d{4}-\d{2}-\d{2}$/.test(filters.to)
      ? `${filters.to}T23:59:59.999`
      : filters.to;
    q = q.lte('created_at', to);
  }
  return q;
}

/** Fetch order_items for the given order ids, grouped by order_id. */
async function loadItemsByOrderId(
  supabase: ReturnType<typeof getServiceRoleSupabase>,
  orderIds: string[],
  label: string,
): Promise<Map<string, OrderItem[]>> {
  const byOrderId = new Map<string, OrderItem[]>();
  if (orderIds.length === 0) return byOrderId;

  const { data: itemRows, error: itemErr } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds);
  if (itemErr) throw new Error(`${label} items: ${itemErr.message}`);

  for (const row of itemRows ?? []) {
    const r = row as { order_id: string };
    const existing = byOrderId.get(r.order_id) ?? [];
    existing.push(mapOrderItem(row));
    byOrderId.set(r.order_id, existing);
  }
  return byOrderId;
}

// ---------- getAllOrdersPaged (admin) ----------
// (replaces the former getAllOrders 100-row hard cap — see below)

/**
 * 페이지네이션 + 서버사이드 상태/검색/기간 필터 (관리자 주문 목록).
 *
 * 기존 getAllOrders(100건 하드캡 + 클라이언트 필터)는 주문이 100건을 넘으면
 * 오래된 주문이 보이지 않고 탭 필터도 잘린 100건 안에서만 동작했다. 이 함수는
 * status/검색어(q)/기간(from,to)을 DB 에서 필터하고 range 로 페이지를 끊어
 * 모든 주문에 접근 가능하게 한다.
 */
export async function getAllOrdersPaged(args: {
  page?: number;
  pageSize?: number;
  status?: OrderStatus | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<{
  items: OrderWithItems[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}> {
  const supabase = getServiceRoleSupabase();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, args.pageSize ?? 20));
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  let query = supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });
  query = applyOrderFilters(query, {
    status: args.status,
    q: args.q,
    from: args.from,
    to: args.to,
  });
  query = query.range(rangeFrom, rangeTo);

  const { data: orderRows, count, error } = await query;
  if (error) throw new Error(`getAllOrdersPaged: ${error.message}`);

  const rows = orderRows ?? [];
  const total = count ?? rows.length;
  if (rows.length === 0) {
    return { items: [], total, page, pageSize, hasMore: false };
  }

  const orderIds = rows.map((r) => (r as { id: string }).id);
  const itemsByOrderId = await loadItemsByOrderId(
    supabase,
    orderIds,
    'getAllOrdersPaged',
  );

  const items = rows.map((row) => {
    const r = row as { id: string };
    return { ...mapOrder(row), items: itemsByOrderId.get(r.id) ?? [] };
  });

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: rangeFrom + items.length < total,
  };
}

// ---------- getOrdersForExport (admin CSV) ----------

/** Hard ceiling on a single CSV export so one request can't pull the whole table. */
const EXPORT_MAX_ROWS = 5000;

/**
 * 동일한 status/q/from/to 필터를 적용해 페이지네이션 없이 주문을 가져온다 (CSV 내보내기용).
 * 최신순, 최대 5000건으로 상한을 둔다.
 */
export async function getOrdersForExport(args: {
  status?: OrderStatus | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<OrderWithItems[]> {
  const supabase = getServiceRoleSupabase();

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  query = applyOrderFilters(query, args);
  query = query.range(0, EXPORT_MAX_ROWS - 1);

  const { data: orderRows, error } = await query;
  if (error) throw new Error(`getOrdersForExport: ${error.message}`);

  const rows = orderRows ?? [];
  if (rows.length === 0) return [];

  const orderIds = rows.map((r) => (r as { id: string }).id);
  const itemsByOrderId = await loadItemsByOrderId(
    supabase,
    orderIds,
    'getOrdersForExport',
  );

  return rows.map((row) => {
    const r = row as { id: string };
    return { ...mapOrder(row), items: itemsByOrderId.get(r.id) ?? [] };
  });
}

// ---------- order memo (isolated; migration 029) ----------

/**
 * Read the orderer-level free-form memo. ISOLATED query on orders.order_memo so
 * the rest of the order pipeline keeps working even if migration 029 is not yet
 * applied. Returns null when the column/value is absent.
 */
export async function getOrderMemo(orderId: OrderId): Promise<string | null> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('orders')
    .select('order_memo')
    .eq('id', orderId as string)
    .maybeSingle();
  if (error) throw new Error(`getOrderMemo: ${error.message}`);
  const memo = (data as { order_memo?: string | null } | null)?.order_memo;
  return memo ?? null;
}

/**
 * Write the orderer-level free-form memo (max 200 chars, app-enforced).
 * ISOLATED single-column update so it never disturbs the shared order SELECT.
 * Passing null clears the memo.
 */
export async function setOrderMemo(
  orderId: OrderId,
  memo: string | null,
): Promise<void> {
  const trimmed = memo == null ? null : memo.slice(0, 200);
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase
    .from('orders')
    .update({ order_memo: trimmed })
    .eq('id', orderId as string);
  if (error) throw new Error(`setOrderMemo: ${error.message}`);
}

// ---------- attach paymentKey (used by confirm route) ----------

export async function attachPaymentKey(
  orderId: OrderId,
  paymentKey: PaymentKey,
): Promise<void> {
  const supabase = getServiceRoleSupabase();
  await supabase
    .from('orders')
    .update({ payment_id: paymentKey as string })
    .eq('id', orderId as string);
}

// ---------- customer self-service (Phase B-1) ----------

/** Result shape for customer-initiated order mutations — errors are values. */
type CustomerActionResult = { ok: boolean; error?: string };

/**
 * 고객 본인 주문취소 (배송 전: CREATED / PAID 만 허용).
 *
 * 관리자 cancelOrderAction 과 동일한 환불-우선 로직을 쓰되, requireAdmin 대신
 * 호출 user 의 소유권(order.userId === userId)으로 게이트한다. 결제가 있는
 * 주문이면 Toss 환불을 먼저 수행하고, 환불 실패 시 상태를 바꾸지 않는다
 * (돈이 돌아가지 않았는데 CANCELLED 로 마킹하는 것을 방지).
 */
export async function customerCancelOrder(
  orderId: OrderId,
  userId: UserId,
  reason = '고객 요청',
): Promise<CustomerActionResult> {
  let order: OrderWithItems | null;
  try {
    order = await getOrder(orderId as string);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '주문을 불러오지 못했습니다.',
    };
  }
  if (!order) {
    return { ok: false, error: '주문을 찾을 수 없습니다.' };
  }

  // Ownership: the order must belong to the authenticated caller. Guest orders
  // (userId null) can never be cancelled through this customer path.
  if (order.userId == null || (order.userId as string) !== (userId as string)) {
    return { ok: false, error: '본인 주문만 취소할 수 있습니다.' };
  }

  if (order.status !== 'CREATED' && order.status !== 'PAID') {
    return {
      ok: false,
      error:
        '배송 준비 중이거나 이미 처리된 주문은 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.',
    };
  }

  const trimmedReason = reason.trim() || '고객 요청';

  // Refund first when the order carries a payment. CREATED orders have none.
  // On refund failure we abort BEFORE the state transition so we never mark an
  // order CANCELLED while the customer's money is still held.
  if (order.paymentId) {
    try {
      await tossClient.cancel({
        paymentKey: order.paymentId,
        cancelReason: trimmedReason,
      });
    } catch (err) {
      return {
        ok: false,
        error: `결제 취소(환불) 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
      };
    }
  }

  try {
    // Use the RESOLVED order.id — `orderId` may be an orderNo (the client sends
    // the human order number), but transitionTo matches on the UUID id. Passing
    // an orderNo here would update 0 rows AFTER the refund already ran.
    await transitionTo(order.id, 'CANCELLED', { reason: trimmedReason });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '주문 취소 처리에 실패했습니다.',
    };
  }

  // Fire-and-forget customer notification (same pattern as admin cancel).
  void notifyCancelled(order, trimmedReason);

  return { ok: true };
}

/**
 * 구매확정 (배송완료 DELIVERED 후 고객이 수령 확인).
 *
 * confirmed_at 을 now() 로 set 한다. 이미 확정된 주문이면 멱등적으로 ok 반환.
 * confirmed_at 컬럼(migration 033)이 아직 미적용이면 UPDATE 가 실패할 수 있으므로
 * try/catch 로 감싸 그 경우에만 graceful error 를 돌려준다. ORDER_STATUSES 는
 * FROZEN 이라 상태 전환 없이 timestamptz 만 갱신한다.
 */
export async function confirmPurchase(
  orderId: OrderId,
  userId: UserId,
): Promise<CustomerActionResult> {
  let order: OrderWithItems | null;
  try {
    order = await getOrder(orderId as string);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '주문을 불러오지 못했습니다.',
    };
  }
  if (!order) {
    return { ok: false, error: '주문을 찾을 수 없습니다.' };
  }

  if (order.userId == null || (order.userId as string) !== (userId as string)) {
    return { ok: false, error: '본인 주문만 구매확정할 수 있습니다.' };
  }

  if (order.status !== 'DELIVERED') {
    return {
      ok: false,
      error: '배송완료된 주문만 구매확정할 수 있습니다.',
    };
  }

  // Idempotent: already confirmed → success without touching the row.
  if (order.confirmedAt != null) {
    return { ok: true };
  }

  // Isolated single-column update. Wrapped so an unapplied migration 033
  // (missing confirmed_at column) degrades to a graceful error instead of
  // throwing through the customer action boundary.
  try {
    const supabase = getServiceRoleSupabase();
    const { error } = await supabase
      .from('orders')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('id', order.id as string);
    if (error) {
      return { ok: false, error: '구매확정 처리에 실패했습니다.' };
    }
  } catch {
    return { ok: false, error: '구매확정 처리에 실패했습니다.' };
  }

  return { ok: true };
}
