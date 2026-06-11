import { getAllOrdersPaged } from '@/lib/db/order';
import { requireAdmin } from '@/lib/db/admin';
import { ORDER_STATUSES, type OrderStatus } from '@/types/order';
import { AdminOrdersClient } from './AdminOrdersClient';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const status: OrderStatus | null =
    sp.status && (ORDER_STATUSES as readonly string[]).includes(sp.status)
      ? (sp.status as OrderStatus)
      : null;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const result = await getAllOrdersPaged({ page, pageSize: PAGE_SIZE, status });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">주문 관리</h1>
        <p className="text-sm text-muted-fg">총 {result.total.toLocaleString('ko-KR')}건</p>
      </div>
      <AdminOrdersClient
        orders={result.items}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        hasMore={result.hasMore}
        status={status}
      />
    </div>
  );
}
