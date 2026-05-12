/**
 * /admin/options — product_variants 매트릭스 + CSV import.
 *
 * Server Component: 활성 상품 + 선택 상품의 모든 변형(비활성 포함)을 가져온다.
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/db/admin';
import { getServerSupabase } from '@/lib/supabase/server';
import { mapProduct, mapVariant } from '@/lib/db/mappers';
import type { Product, ProductVariant } from '@/types/product';
import { OptionsClient } from './OptionsClient';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ product?: string }>;

async function loadProducts(): Promise<Product[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw new Error(`loadProducts: ${error.message}`);
  return (data ?? []).map(mapProduct);
}

async function loadVariants(productId: string): Promise<ProductVariant[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from('product_variants')
    .select('*')
    .eq('product_id', productId)
    .order('size_code', { ascending: true })
    .order('color_code', { ascending: true })
    .order('matte_code', { ascending: true })
    .order('paper_code', { ascending: true });
  if (error) throw new Error(`loadVariants: ${error.message}`);
  return (data ?? []).map(mapVariant);
}

export default async function AdminOptionsPage({
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
    // env not configured
  }

  const selectedProductId =
    sp.product && products.some((p) => p.id === sp.product)
      ? sp.product
      : (products[0]?.id ?? null);

  let variants: ProductVariant[] = [];
  if (selectedProductId) {
    try {
      variants = await loadVariants(selectedProductId);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">옵션 매트릭스</h1>
        <p className="text-sm text-muted-fg">
          상품별 사이즈·색상·매트·인화지 조합과 가격·재고를 관리합니다. CSV/TSV
          일괄 등록을 지원합니다 (AC-6, AC-7).
        </p>
      </header>

      <OptionsClient
        products={products}
        selectedProductId={selectedProductId}
        variants={variants}
      />
    </div>
  );
}
