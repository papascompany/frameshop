/**
 * user_addresses — 회원 배송지 주소록 데이터 접근 (Phase B-1, migration 032).
 *
 * Server-only. Uses the service-role client, which BYPASSES RLS — therefore
 * ownership is enforced *in code*: every query is scoped by `user_id`, and
 * mutations match on (id, user_id) so a caller can never read or mutate another
 * user's address even if they guess an id. RLS (owner-only policy on the table)
 * remains as defence-in-depth for any other path.
 *
 * Reads/writes are ISOLATED to the user_addresses table so the rest of the app
 * keeps compiling/working even if migration 032 is unapplied in a given DB.
 */

import 'server-only';
import { getServiceRoleSupabase } from '@/lib/supabase/service';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import type { AddressInput, UserAddress, UserAddressId } from '@/types/address';

// ---------- row shape + mapper ----------

type UserAddressRow = {
  id: string;
  user_id: string;
  label: string;
  recipient_name: string;
  phone: string;
  zip: string;
  addr1: string;
  addr2: string;
  memo: string;
  is_default: boolean;
  created_at: string;
};

function mapAddress(row: UserAddressRow): UserAddress {
  return {
    id: row.id as UserAddressId,
    userId: asBrand<UserId>(row.user_id),
    label: row.label ?? '',
    recipientName: row.recipient_name,
    phone: row.phone,
    zip: row.zip,
    addr1: row.addr1,
    addr2: row.addr2 ?? '',
    memo: row.memo ?? '',
    isDefault: row.is_default ?? false,
    createdAt: row.created_at,
  };
}

/**
 * Normalize validated input into the DB column set. Optional string fields
 * collapse to '' (columns are NOT NULL DEFAULT ''); isDefault defaults false.
 * `is_default` is deliberately omitted here when handled separately by the
 * caller (see create/update), so it is set explicitly rather than via this map.
 */
function toRowPatch(input: AddressInput): {
  label: string;
  recipient_name: string;
  phone: string;
  zip: string;
  addr1: string;
  addr2: string;
  memo: string;
} {
  return {
    label: input.label ?? '',
    recipient_name: input.recipientName,
    phone: input.phone,
    zip: input.zip,
    addr1: input.addr1,
    addr2: input.addr2 ?? '',
    memo: input.memo ?? '',
  };
}

// ---------- result tuple ----------

type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// ---------- queries (always scoped by userId) ----------

/** List a user's saved addresses, default first, then newest. */
export async function listAddresses(
  userId: UserId,
): Promise<DbResult<UserAddress[]>> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('user_addresses')
    .select('*')
    .eq('user_id', userId as string)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return { data: null, error: error.message };
  return { data: ((data ?? []) as UserAddressRow[]).map(mapAddress), error: null };
}

/**
 * Create a saved address for the user. When `isDefault` is true, clears any
 * existing default first so the partial-unique index (one default per user)
 * never conflicts.
 */
export async function createAddress(
  userId: UserId,
  input: AddressInput,
): Promise<DbResult<UserAddress>> {
  const supabase = getServiceRoleSupabase();
  const makeDefault = input.isDefault === true;

  if (makeDefault) {
    const cleared = await clearDefault(userId);
    if (cleared.error) return { data: null, error: cleared.error };
  }

  const { data, error } = await supabase
    .from('user_addresses')
    .insert({
      user_id: userId as string,
      ...toRowPatch(input),
      is_default: makeDefault,
    })
    .select('*')
    .single();

  if (error || !data) {
    return { data: null, error: error?.message ?? 'createAddress: insert failed' };
  }
  return { data: mapAddress(data as UserAddressRow), error: null };
}

/**
 * Update one of the user's addresses. Matches on (id, user_id) so a caller can
 * only touch their own rows. When promoting to default, clears the prior
 * default first.
 */
export async function updateAddress(
  userId: UserId,
  id: UserAddressId,
  input: AddressInput,
): Promise<DbResult<UserAddress>> {
  const supabase = getServiceRoleSupabase();
  const makeDefault = input.isDefault === true;

  if (makeDefault) {
    // Clear other defaults (excluding this row so a no-op re-save still works).
    const cleared = await clearDefault(userId, id);
    if (cleared.error) return { data: null, error: cleared.error };
  }

  const patch: Record<string, unknown> = {
    ...toRowPatch(input),
    updated_at: new Date().toISOString(),
  };
  // Only write is_default when the input expresses an explicit intent. An
  // absent isDefault leaves the current flag untouched.
  if (input.isDefault !== undefined) {
    patch.is_default = makeDefault;
  }

  const { data, error } = await supabase
    .from('user_addresses')
    .update(patch)
    .eq('id', id as string)
    .eq('user_id', userId as string)
    .select('*')
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'updateAddress: not found or not owned' };
  return { data: mapAddress(data as UserAddressRow), error: null };
}

/** Delete one of the user's addresses (scoped by user_id). */
export async function deleteAddress(
  userId: UserId,
  id: UserAddressId,
): Promise<DbResult<true>> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('user_addresses')
    .delete()
    .eq('id', id as string)
    .eq('user_id', userId as string)
    .select('id')
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'deleteAddress: not found or not owned' };
  return { data: true, error: null };
}

/**
 * Mark one address as the user's default. Clears the prior default first
 * (partial unique index permits a single default per user), then sets the
 * target. Both steps are scoped by user_id.
 */
export async function setDefaultAddress(
  userId: UserId,
  id: UserAddressId,
): Promise<DbResult<UserAddress>> {
  const supabase = getServiceRoleSupabase();

  const cleared = await clearDefault(userId, id);
  if (cleared.error) return { data: null, error: cleared.error };

  const { data, error } = await supabase
    .from('user_addresses')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id as string)
    .eq('user_id', userId as string)
    .select('*')
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'setDefaultAddress: not found or not owned' };
  return { data: mapAddress(data as UserAddressRow), error: null };
}

// ---------- internals ----------

/**
 * Unset is_default for the user's addresses, optionally excluding one id. Run
 * before setting a new default so the (user_id) WHERE is_default partial unique
 * index can never collide.
 */
async function clearDefault(
  userId: UserId,
  exceptId?: UserAddressId,
): Promise<DbResult<true>> {
  const supabase = getServiceRoleSupabase();
  let query = supabase
    .from('user_addresses')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId as string)
    .eq('is_default', true);

  if (exceptId !== undefined) {
    query = query.neq('id', exceptId as string);
  }

  const { error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
}
