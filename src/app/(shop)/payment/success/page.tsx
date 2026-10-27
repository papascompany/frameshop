import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { Container } from '@/components/layout/Container';
import { confirmFromSuccessRedirect } from '@/lib/payment/redirect-confirm';
import { tossErrorCopy } from '@/lib/payment/error-copy';
import { getClientIp } from '@/lib/security/client-ip';
import { PaymentSuccessClient } from './PaymentSuccessClient';

/**
 * Toss success URL → server-side confirm → /order/success.
 *
 * The confirm runs during this server render (not in a client effect), so it
 * starts the moment the buyer's browser lands back from Toss and finishes even
 * if the tab closes or client JS never runs. `loading.tsx` streams the
 * "확인 중" UI meanwhile; `after()` keeps the invocation alive until the
 * confirm settles should the stream be torn down first. On failure the client
 * component shows the reason plus a retry that hits /api/payment/confirm.
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

  const clientIp = getClientIp({ headers: await headers() });
  const pending = confirmFromSuccessRedirect(
    { paymentKey: sp.paymentKey, orderId: sp.orderId, amount: sp.amount },
    clientIp,
  );
  after(() => pending.then(() => undefined, () => undefined));
  const result = await pending;

  if (result.ok) {
    redirect(`/order/success?orderNo=${encodeURIComponent(result.orderNo)}`);
  }

  return (
    <Container size="sm" className="py-10">
      <PaymentSuccessClient
        paymentKey={sp.paymentKey}
        orderId={sp.orderId}
        amount={Number(sp.amount)}
        initialMessage={tossErrorCopy(result.code, result.message)}
      />
    </Container>
  );
}
