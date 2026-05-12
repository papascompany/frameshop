/**
 * /admin/curation — 랜딩 배너/컬렉션/feature 관리.
 *
 * Server Component: 모든 큐레이션(비활성 포함)을 가져온다. 활성/기간 필터는
 * 사용자 측 M-Landing 책임이므로 어드민은 풀 리스트를 노출한다.
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/db/admin';
import { getServerSupabase } from '@/lib/supabase/server';
import { mapCuration, mapProduct } from '@/lib/db/mappers';
import type { Curation } from '@/types/curation';
import type { Product } from '@/types/product';
import { CurationClient } from './CurationClient';

export const dynamic = 'force-dynamic';

async function loadCurations(): Promise<Curation[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('curations')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw new Error(`loadCurations: ${error.message}`);
  return (data ?? []).map(mapCuration);
}

async function loadProducts(): Promise<Product[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`loadProducts: ${error.message}`);
  return (data ?? []).map(mapProduct);
}

export default async function AdminCurationPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }

  let curations: Curation[] = [];
  let products: Product[] = [];
  try {
    [curations, products] = await Promise.all([loadCurations(), loadProducts()]);
  } catch {
    // env not configured
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">큐레이션</h1>
        <p className="text-sm text-muted-fg">
          랜딩 페이지의 배너·컬렉션·feature 슬롯을 등록합니다. 배너 이미지/링크
          URL 은 https 만 허용됩니다 (ADR-016).
        </p>
      </header>

      <CurationClient curations={curations} products={products} />
    </div>
  );
}
