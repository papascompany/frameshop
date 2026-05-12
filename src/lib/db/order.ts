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
      'id, is_active, price, product_id, size_label, color_label, color_code, products(name)',
    )
    .in('id', variantIds);
  if (vErr) {
    throw new CreateOrderError('INVALID_VARIANT', vErr.message);
  }
  type VariantWithProduct = {
    id: string;
    is_active: boolean;
    price: number;
    product_id: string;
    size_label: string;
    color_label: string;
    color_code: string;
    products: { name: string } | { name: string }[] | null;
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
    const productName = Array.isArray(v.products)
      ? (v.products[0]?.name ?? '')
      : (v.products?.name ?? '');
    const snapshot: OrderItemSnapshot = {
      productId: item.productId,
      variantId: item.variantId,
      productName,
      options: item.options,
      sizeLabel: v.size_label,
      colorLabel: v.color_label,
      unitPrice: v.price,
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
