/**
 * Curation queries (M-Landing + M-Admin, ADR-007).
 */

import 'server-only';
import type { CurationDevice, Curation, CurationType } from '@/types/curation';
import { payloadSchemaFor, type PayloadValidation } from '@/types/curation';
import { mapCuration } from './mappers';
import { getServerSupabase } from '../supabase/server';

export async function getActiveCurations(
  device: CurationDevice,
  now: Date = new Date(),
): Promise<Curation[]> {
  const supabase = await getServerSupabase();
  const isoNow = now.toISOString();

  // device filter: row.device === device || row.device === 'all'.
  // When `device === 'all'`, we return ALL devices (admin / preview path).
  let query = supabase
    .from('curations')
    .select('*')
    .eq('is_active', true)
    .or(`start_at.is.null,start_at.lte.${isoNow}`)
    .or(`end_at.is.null,end_at.gt.${isoNow}`);

  if (device !== 'all') {
    query = query.in('device', [device, 'all']);
  }

  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getActiveCurations: ${error.message}`);
  return (data ?? []).map(mapCuration);
}

export function validateCurationPayload<T>(
  type: CurationType,
  payload: unknown,
): PayloadValidation<T> {
  const schema = payloadSchemaFor(type);
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, payload: result.data as T };
}
