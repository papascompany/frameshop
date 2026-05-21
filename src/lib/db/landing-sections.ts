/**
 * landing_sections — 랜딩 페이지 섹션 CMS CRUD
 *
 * SELECT: anon 클라이언트 (public_read RLS 정책)
 * INSERT/UPDATE/DELETE: 서비스롤 (어드민 전용)
 */

import 'server-only';
import { unstable_cache } from 'next/cache';
import { getAnonSupabase } from '@/lib/supabase/anon';
import { getServiceRoleSupabase } from '@/lib/supabase/service';

export type LandingSectionType =
  | 'hero'
  | 'masterpiece'
  | 'landscape'
  | 'lifestyle'
  | 'member_benefit';

export type LandingSection = {
  id: string;
  sectionKey: string;
  sectionType: LandingSectionType;
  sortOrder: number;
  isActive: boolean;
  imageUrl: string | null;
  payload: Record<string, unknown>;
  updatedAt: string;
};

// ─── 맵퍼 ────────────────────────────────────────────────────────────────────

function mapRow(row: Record<string, unknown>): LandingSection {
  return {
    id: row['id'] as string,
    sectionKey: row['section_key'] as string,
    sectionType: row['section_type'] as LandingSectionType,
    sortOrder: row['sort_order'] as number,
    isActive: row['is_active'] as boolean,
    imageUrl: (row['image_url'] as string | null) ?? null,
    payload: (row['payload'] as Record<string, unknown>) ?? {},
    updatedAt: row['updated_at'] as string,
  };
}

// ─── 공개 조회 (캐시됨) ──────────────────────────────────────────────────────

async function _getAllLandingSections(): Promise<LandingSection[]> {
  const supabase = getAnonSupabase();
  const { data, error } = await supabase
    .from('landing_sections')
    .select('*')
    .eq('is_active', true)
    .order('section_type', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[landing-sections] getAllLandingSections error:', error.message);
    return [];
  }
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

/**
 * 랜딩 페이지용 전체 섹션 조회 — 60초 캐시, 'landing-sections' 태그로 무효화.
 */
export const getAllLandingSections = unstable_cache(
  _getAllLandingSections,
  ['landing-sections-all'],
  { revalidate: 60, tags: ['landing-sections'] },
);

/**
 * 특정 section_key 조회 (캐시 없음 — 어드민 페이지 직접 조회용).
 */
export async function getLandingSection(key: string): Promise<LandingSection | null> {
  const supabase = getAnonSupabase();
  const { data, error } = await supabase
    .from('landing_sections')
    .select('*')
    .eq('section_key', key)
    .single();

  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

// ─── 어드민 전용 (캐시 없음) ─────────────────────────────────────────────────

/**
 * 어드민 페이지용 — 비활성 포함 전체 조회 (서비스롤).
 */
export async function getAllLandingSectionsAdmin(): Promise<LandingSection[]> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('landing_sections')
    .select('*')
    .order('section_type', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[landing-sections] getAllLandingSectionsAdmin error:', error.message);
    return [];
  }
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

type UpsertInput = {
  sectionKey: string;
  sectionType: string;
  sortOrder: number;
  isActive?: boolean;
  imageUrl?: string | null;
  payload?: Record<string, unknown>;
};

export async function upsertLandingSection(input: UpsertInput): Promise<LandingSection> {
  const supabase = getServiceRoleSupabase();

  const payload: Record<string, unknown> = {
    section_key: input.sectionKey,
    section_type: input.sectionType,
    sort_order: input.sortOrder,
    is_active: input.isActive ?? true,
    payload: input.payload ?? {},
  };

  // image_url이 명시적으로 null이 아닌 경우에만 포함 (null 전달 시 삭제 처리)
  if (input.imageUrl !== undefined) {
    payload['image_url'] = input.imageUrl;
  }

  const { data, error } = await supabase
    .from('landing_sections')
    .upsert(payload, { onConflict: 'section_key' })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `[landing-sections] upsertLandingSection failed: ${error?.message ?? 'no data'}`,
    );
  }
  return mapRow(data as Record<string, unknown>);
}
