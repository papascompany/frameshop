/**
 * Server-side cart helpers (M-Cart).
 *
 * Authenticated users only — anon cart lives in LocalStorage and is handled
 * entirely on the client.
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type {
  CartItemId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from '@/types/common';
import type { CartItem } from '@/types/cart';
import { getServerSupabase } from '../supabase/server';

type CartRowWithVariant = {
  id: string;
  local_id: string;
  user_id: string;
  variant_id: string;
  photo_id: string;
  options: CartItem['options'];
  photo_url: string;
  crop_transform: CartItem['cropTransform'];
  preview_url: string;
  price: number;
  quantity: number;
  created_at: string;
  product_variants: { product_id: string } | { product_id: string }[] | null;
};

function pickProductId(joined: CartRowWithVariant['product_variants']): string {
  if (!joined) return '';
  if (Array.isArray(joined)) return joined[0]?.product_id ?? '';
  return joined.product_id;
}

export async function listCartForUser(userId: UserId): Promise<CartItem[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('cart_items')
    .select(
      'id, local_id, user_id, variant_id, photo_id, options, photo_url, crop_transform, preview_url, price, quantity, created_at, product_variants(product_id)',
    )
    .eq('user_id', userId as string)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listCartForUser: ${error.message}`);

  return ((data ?? []) as unknown as CartRowWithVariant[]).map((row) => ({
    id: asBrand<CartItemId>(row.id),
    localId: asBrand<LocalId>(row.local_id),
    userId: asBrand<UserId>(row.user_id),
    productId: asBrand<ProductId>(pickProductId(row.product_variants)),
    variantId: asBrand<ProductVariantId>(row.variant_id),
    photoId: asBrand<PhotoId>(row.photo_id),
    options: row.options,
    photoUrl: row.photo_url,
    cropTransform: row.crop_transform,
    previewUrl: row.preview_url,
    price: row.price,
    quantity: row.quantity,
    createdAt: row.created_at,
  }));
}

export async function upsertCartItem(input: CartItem): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('cart_items')
    .upsert(
      {
        local_id: input.localId as string,
        user_id: input.userId as string,
        variant_id: input.variantId as string,
        photo_id: input.photoId as string,
        options: input.options,
        photo_url: input.photoUrl,
        crop_transform: input.cropTransform,
        preview_url: input.previewUrl,
        price: input.price,
        quantity: input.quantity,
      },
      { onConflict: 'user_id,local_id' },
    );
  if (error) throw new Error(`upsertCartItem: ${error.message}`);
}

export async function updateCartQuantity(
  userId: UserId,
  localId: LocalId,
  quantity: number,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('cart_items')
    .update({ quantity })
    .eq('user_id', userId as string)
    .eq('local_id', localId as string);
  if (error) throw new Error(`updateCartQuantity: ${error.message}`);
}

export async function removeCartItem(
  userId: UserId,
  localId: LocalId,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('user_id', userId as string)
    .eq('local_id', localId as string);
  if (error) throw new Error(`removeCartItem: ${error.message}`);
}

export async function clearCartItems(
  userId: UserId,
  localIds?: LocalId[],
): Promise<void> {
  const supabase = await getServerSupabase();
  let q = supabase.from('cart_items').delete().eq('user_id', userId as string);
  if (localIds && localIds.length > 0) {
    q = q.in('local_id', localIds as unknown as string[]);
  }
  const { error } = await q;
  if (error) throw new Error(`clearCartItems: ${error.message}`);
}
