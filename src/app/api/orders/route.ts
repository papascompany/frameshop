/**
 * POST /api/orders — createOrder bridge.
 *
 * Body:
 *   {
 *     cartItems: CartItem[],
 *     orderer, shipping, shippingMethod,
 *     clientShippingFee?: number,
 *   }
 *
 * Returns: { ok: true, order } | { ok: false, code, message }.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { cartItemSchema } from '@/types/cart';
import {
  createOrderInputSchema,
  CreateOrderError,
  type CreateOrderInput,
} from '@/types/order';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import { createOrder } from '@/lib/db/order';
import { getServerSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security/same-origin';
import { z } from 'zod';

const bodySchema = z.object({
  cartItems: z.array(cartItemSchema).min(1),
}).and(createOrderInputSchema);

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: 'BAD_ORIGIN', message: 'Cross-origin request rejected' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: 'BAD_JSON' },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 422 },
    );
  }

  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  const input: CreateOrderInput = {
    cartItems: parsed.data.cartItems as unknown as CreateOrderInput['cartItems'],
    orderer: parsed.data.orderer,
    shipping: parsed.data.shipping,
    shippingMethod: parsed.data.shippingMethod,
    clientShippingFee: parsed.data.clientShippingFee,
    userId: userId
      ? asBrand<UserId>(userId)
      : parsed.data.userId
        ? asBrand<UserId>(parsed.data.userId)
        : null,
  };

  try {
    const order = await createOrder(input);
    return NextResponse.json({ ok: true, order }, { status: 200 });
  } catch (err) {
    if (err instanceof CreateOrderError) {
      const status = err.code === 'EMPTY_CART' ? 400
        : err.code === 'INVALID_VARIANT' ? 422
        : err.code === 'INVALID_SHIPPING_METHOD' ? 422
        : err.code === 'SHIPPING_FEE_MISMATCH' ? 422
        : err.code === 'PRICE_MISMATCH' ? 422
        : 500;
      return NextResponse.json(
        { ok: false, code: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
