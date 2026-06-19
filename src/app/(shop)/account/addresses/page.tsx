import { redirect } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { getServerSupabase } from '@/lib/supabase/server';
import { listAddresses } from '@/lib/db/addresses';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import type { UserAddress } from '@/types/address';
import { AddressesClient } from './AddressesClient';

export const dynamic = 'force-dynamic';

export default async function AddressesPage() {
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect('/login?redirect=/account/addresses');
  }

  const userId = asBrand<UserId>(userData.user.id);
  // 마이그레이션 032가 아직 적용되지 않았더라도 페이지가 죽지 않도록 빈 배열로 폴백.
  let addresses: UserAddress[] = [];
  const { data, error } = await listAddresses(userId);
  if (!error && data) {
    addresses = data;
  }

  return (
    <Container size="md" className="py-10">
      <h1 className="text-xl font-bold mb-6">배송지 관리</h1>
      <AddressesClient initialAddresses={addresses} />
    </Container>
  );
}
