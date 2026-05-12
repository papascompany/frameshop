/**
 * /api/cart — authed cart sync.
 *  GET   → list user's cart items
 *  POST  → upsert single cart item (body: CartItem JSON)
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { cartItemSchema } from '@/types/cart';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import type { CartItem } from '@/types/cart';
import { listCartForUser, upsertCartItem } from '@/lib/db/cart';
import { getServerSupabase } from '@/lib/supabase/server';

async function getUserId(): Promise<UserId | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ? asBrand<UserId>(data.user.id) : null;
}

export async function GET(): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  const items = await listCartForUser(userId);
  return NextResponse.json({ ok: true, items });
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHENTICATED' },
      { status: 401 },
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
  const parsed = cartItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: 'BAD_INPUT', message: parsed.error.message },
      { status: 422 },
    );
  }
  // Owner override is forced server-side: ignore client's userId.
  const item = { ...parsed.data, userId: userId } as CartItem;
  await upsertCartItem(item);
  return NextResponse.json({ ok: true });
}
