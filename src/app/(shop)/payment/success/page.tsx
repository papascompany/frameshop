import { redirect } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { PaymentSuccessClient } from './PaymentSuccessClient';

/**
 * Toss success URL → POST /api/payment/confirm → /order/success.
 * The actual confirm call runs client-side so we have access to the
 * paymentKey/orderId/amount query params Toss sent.
 */
export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    paymentKey?: string;
    orderId?: string;
    amount?: string;
  }>;
}) {
  const sp = await searchParams;
  if (!sp.paymentKey || !sp.orderId || !sp.amount) {
    redirect('/cart');
  }
  return (
    <Container size="sm" className="py-10">
      <PaymentSuccessClient
        paymentKey={sp.paymentKey}
        orderId={sp.orderId}
        amount={Number(sp.amount)}
      />
    </Container>
  );
}
