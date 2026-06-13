import Link from 'next/link';
import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/Button';
import { tossErrorCopy } from '@/lib/payment/error-copy';

export default async function PaymentFailPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; message?: string }>;
}) {
  const sp = await searchParams;
  // Map the raw Toss code to friendly Korean (never echo an English code).
  const copy = tossErrorCopy(sp.code, sp.message);

  return (
    <Container size="sm" className="py-10 text-center">
      <h1 className="text-xl font-bold mb-2">결제를 완료하지 못했어요</h1>
      <p className="text-sm text-muted-fg mb-6">{copy}</p>

      {/* 장바구니는 결제 성공 시에만 비워지므로 그대로 유지됨 → 바로 재결제 가능 */}
      <div className="flex flex-col gap-2 max-w-xs mx-auto">
        <Link href="/checkout" className="w-full">
          <Button variant="primary" size="lg" fullWidth>다시 결제하기</Button>
        </Link>
        <Link href="/cart" className="w-full">
          <Button variant="secondary" size="lg" fullWidth>장바구니 확인</Button>
        </Link>
      </div>
    </Container>
  );
}
