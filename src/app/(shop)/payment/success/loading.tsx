import { Container } from '@/components/layout/Container';
import { PaymentConfirmingNotice } from './PaymentSuccessClient';

/**
 * Streamed while page.tsx confirms the payment server-side — replaces the shop
 * root skeleton (a landing-page hero) that would otherwise show here.
 */
export default function PaymentSuccessLoading() {
  return (
    <Container size="sm" className="py-10">
      <PaymentConfirmingNotice />
    </Container>
  );
}
