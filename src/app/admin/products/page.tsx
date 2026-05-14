import { redirect } from 'next/navigation';
import { requireAdmin, getAllProductsAdmin } from '@/lib/db/admin';
import { getCategories } from '@/lib/db/catalog';
import { ProductsClient } from './ProductsClient';

export const dynamic = 'force-dynamic';

export default async function AdminProductsPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?redirect=/admin/products');
  }

  const [products, categories] = await Promise.all([
    getAllProductsAdmin(),
    getCategories(),
  ]);

  return (
    <>
      <h1 className="text-2xl font-bold mb-6">상품 관리</h1>
      <ProductsClient products={products} categories={categories} />
    </>
  );
}
