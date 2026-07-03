import { redirect } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { getServerSupabase } from '@/lib/supabase/server';
import { getOrdersByUser } from '@/lib/db/order';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import { maskReceiptInfo } from '@/types/order';
import { MyOrdersClient } from './MyOrdersClient';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

export default async function MyOrdersPage() {
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect('/login?redirect=/account/orders');
  }

  const t = await getTranslations('account');
  const userId = asBrand<UserId>(userData.user.id);
  // FS-EC P2-1: 현금영수증 식별번호(PII) 원문을 클라이언트 props 로 직렬화하지
  // 않는다 — 서버에서 마스킹(뒤 4자리 외 *) 후 전달 (admin 상세와 동일 처리).
  const orders = (await getOrdersByUser(userId)).map((order) => ({
    ...order,
    receiptInfo: maskReceiptInfo(order.receiptInfo ?? null),
  }));

  return (
    <Container size="md" className="py-10">
      <h1 className="text-xl font-bold mb-6">{t('orders')}</h1>
      <MyOrdersClient orders={orders} />
    </Container>
  );
}
