import { redirect } from 'next/navigation';
import { requireAdmin, getAllCategoriesAdmin } from '@/lib/db/admin';
import { CategoriesClient } from './CategoriesClient';

export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?redirect=/admin/categories');
  }

  const categories = await getAllCategoriesAdmin();

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">상품 라인(카테고리)</h1>
      </div>
      <CategoriesClient categories={categories} />
    </>
  );
}
