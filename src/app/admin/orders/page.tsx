import { getAllOrders } from '@/lib/db/order';
import { requireAdmin } from '@/lib/db/admin';
import { AdminOrdersClient } from './AdminOrdersClient';

export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage() {
  await requireAdmin();

  const orders = await getAllOrders(100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">주문 관리</h1>
        <p className="text-sm text-muted-fg">최근 {orders.length}건</p>
      </div>
      <AdminOrdersClient orders={orders} />
    </div>
  );
}
