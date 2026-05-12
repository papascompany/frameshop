import Link from 'next/link';
import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/Button';

export default async function PaymentFailPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; message?: string }>;
}) {
  const sp = await searchParams;
  return (
    <Container size="sm" className="py-10 text-center">
      <h1 className="text-xl font-bold mb-2">결제에 실패했습니다</h1>
      <p className="text-sm text-muted-fg mb-6">
        {sp.message ?? sp.code ?? '잠시 후 다시 시도해주세요.'}
      </p>
      <Link href="/cart">
        <Button variant="primary" size="lg">장바구니로 돌아가기</Button>
      </Link>
    </Container>
  );
}
