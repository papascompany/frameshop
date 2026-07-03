import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/db/admin';
import { getOrder } from '@/lib/db/order';
import { isPartialRefundAvailable } from '@/lib/db/feature-probe';
import { maskReceiptInfo } from '@/types/order';
import { AdminOrderDetailClient } from './AdminOrderDetailClient';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AdminOrderDetailPage({ params }: Props) {
  await requireAdmin();

  const { id } = await params;
  // 038(refunded_amount) 미적용이면 부분환불 UI 를 아예 노출하지 않는다.
  const [order, partialRefundAvailable] = await Promise.all([
    getOrder(id),
    isPartialRefundAvailable(),
  ]);

  if (!order) {
    notFound();
  }

  // FS-EC P2-1: 현금영수증 식별번호(PII) 원문을 클라이언트 props 로 직렬화하지
  // 않는다 — 서버에서 마스킹(뒤 4자리 외 *) 후 전달. 클라이언트의 렌더 시점
  // 마스킹은 마스킹된 값에 멱등이라 표시 결과는 동일하다.
  const safeOrder = {
    ...order,
    receiptInfo: maskReceiptInfo(order.receiptInfo ?? null),
  };

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

      <AdminOrderDetailClient
        order={safeOrder}
        partialRefundAvailable={partialRefundAvailable}
      />
    </div>
  );
}
