import { Container } from '@/components/layout/Container';
import { OrderLookupClient } from './OrderLookupClient';

export default function OrderLookupPage() {
  return (
    <Container size="sm" className="py-10">
      <h1 className="text-xl font-bold mb-4">주문 조회 (비회원)</h1>
      <OrderLookupClient />
    </Container>
  );
}
