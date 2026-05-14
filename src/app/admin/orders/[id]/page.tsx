import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/db/admin';
import { getOrder } from '@/lib/db/order';
import { AdminOrderDetailClient } from './AdminOrderDetailClient';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AdminOrderDetailPage({ params }: Props) {
  await requireAdmin();

  const { id } = await params;
  const order = await getOrder(id);

  if (!order) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/orders"
          className="text-sm text-muted-fg hover:text-foreground transition-colors"
        >
          &larr; 주문 목록
        </Link>
        <h1 className="text-2xl font-bold">주문 상세</h1>
      </div>

      <AdminOrderDetailClient order={order} />
    </div>
  );
}
