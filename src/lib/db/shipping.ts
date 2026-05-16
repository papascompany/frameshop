/**
 * Shipping methods read/write (M-Checkout + M-Admin, ADR-008).
 *
 * getShippingMethods (customer-facing) is wrapped with unstable_cache
 * (300 s) because shipping options are public and change only via admin.
 * Admin mutations should call revalidateTag('shipping') to flush.
 */

import 'server-only';
import { unstable_cache } from 'next/cache';
import type { ShippingMethodConfig, ShippingMethodInput } from '@/types/shipping';
import { mapShippingMethod } from './mappers';
import { getServerSupabase } from '../supabase/server';
import { getServiceRoleSupabase } from '../supabase/service';

/** Customer-facing: active rows only. */
async function _getShippingMethods(): Promise<ShippingMethodConfig[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('shipping_methods')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`getShippingMethods: ${error.message}`);
  return (data ?? []).map(mapShippingMethod);
}

export const getShippingMethods = unstable_cache(
  _getShippingMethods,
  ['shipping-methods'],
  { revalidate: 300, tags: ['shipping'] },
);

/** Admin: includes inactive rows. RLS requires admin role. */
export async function listShippingMethods(): Promise<ShippingMethodConfig[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('shipping_methods')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`listShippingMethods: ${error.message}`);
  return (data ?? []).map(mapShippingMethod);
}

/** Bulk update — admin server action only. */
export async function bulkUpdateShippingMethods(
  rows: ShippingMethodInput[],
): Promise<ShippingMethodConfig[]> {
  const supabase = getServiceRoleSupabase();
  const updates = rows.map((row) =>
    supabase
      .from('shipping_methods')
      .update({
        label: row.label,
        fee: row.fee,
        free_threshold: row.freeThreshold,
        note: row.note,
        is_active: row.isActive,
        sort_order: row.sortOrder,
      })
      .eq('code', row.code)
      .select()
      .single(),
  );

  const results = await Promise.all(updates);
  const out: ShippingMethodConfig[] = [];
  for (const r of results) {
    if (r.error) throw new Error(`bulkUpdateShippingMethods: ${r.error.message}`);
    out.push(mapShippingMethod(r.data));
  }
  return out;
}
