/**
 * app_settings — 어드민 설정 키-값 CRUD (서비스롤 전용).
 *
 * RLS 정책이 false이므로 anon/auth 클라이언트로는 접근 불가.
 * 반드시 getServiceRoleSupabase() 사용.
 */

import 'server-only';
import { getServiceRoleSupabase } from '@/lib/supabase/service';

// ─── 단건 조회 ──────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    console.error('[settings] getSetting error:', error.message);
    return null;
  }
  return data?.value ?? null;
}

// ─── 복수 조회 ──────────────────────────────────────────────────────────────

export async function getSettings(
  keys: string[],
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', keys);

  if (error) {
    console.error('[settings] getSettings error:', error.message);
    return {};
  }
  const result: Record<string, string> = {};
  for (const row of data ?? []) {
    result[row.key] = row.value;
  }
  return result;
}

// ─── 단건 upsert ────────────────────────────────────────────────────────────

export async function setSetting(key: string, value: string): Promise<void> {
  const supabase = getServiceRoleSupabase();
  const { error } = await supabase.from('app_settings').upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  if (error) {
    throw new Error(`[settings] setSetting failed for key "${key}": ${error.message}`);
  }
}
