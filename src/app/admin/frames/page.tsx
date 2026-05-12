/**
 * /admin/frames — Frame Assets 관리.
 *
 * - Server Component: 활성 상품 목록 + 선택된 상품의 frame_assets 를 쿼리.
 * - 검색 파라미터 `?product=<uuid>` 로 선택 유지 (URL state).
 * - 인터랙티브 폼은 `FramesClient` (use client) 가 담당.
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/db/admin';
import { getServerSupabase } from '@/lib/supabase/server';
import { mapFrameAsset, mapProduct } from '@/lib/db/mappers';
import type { FrameAsset, Product } from '@/types/product';
import { FramesClient } from './FramesClient';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ product?: string }>;

async function loadProducts(): Promise<Product[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw new Error(`loadProducts: ${error.message}`);
  return (data ?? []).map(mapProduct);
}

async function loadFrames(productId: string): Promise<FrameAsset[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('frame_assets')
    .select('*')
    .eq('product_id', productId)
    .order('color_code', { ascending: true });
  if (error) throw new Error(`loadFrames: ${error.message}`);
  return (data ?? []).map(mapFrameAsset);
}

export default async function AdminFramesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }

  const sp = await searchParams;

  let products: Product[] = [];
  try {
    products = await loadProducts();
  } catch {
    // env not configured (Phase 1 stub fallback).
  }

  const selectedProductId =
    sp.product && products.some((p) => p.id === sp.product)
      ? sp.product
      : (products[0]?.id ?? null);

  let frames: FrameAsset[] = [];
  if (selectedProductId) {
    try {
      frames = await loadFrames(selectedProductId);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">프레임 자산 관리</h1>
        <p className="text-sm text-muted-fg">
          상품별 컬러 옵션(프레임 PNG)을 등록·수정합니다. inner_rect 는
          정규화된 0~1 좌표입니다.
        </p>
      </header>

      <FramesClient
        products={products}
        selectedProductId={selectedProductId}
        frames={frames}
      />
    </div>
  );
}
