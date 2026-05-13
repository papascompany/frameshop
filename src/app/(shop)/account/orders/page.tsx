import { redirect } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { getServerSupabase } from '@/lib/supabase/server';
import { getOrdersByUser } from '@/lib/db/order';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import { MyOrdersClient } from './MyOrdersClient';

export const dynamic = 'force-dynamic';

export default async function MyOrdersPage() {
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect('/login?redirect=/account/orders');
  }

  const userId = asBrand<UserId>(userData.user.id);
  const orders = await getOrdersByUser(userId);

  return (
    <Container size="md" className="py-10">
      <h1 className="text-xl font-bold mb-6">주문 내역</h1>
      <MyOrdersClient orders={orders} />
    </Container>
  );
}
