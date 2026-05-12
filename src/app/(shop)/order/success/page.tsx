import Link from 'next/link';
import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ orderNo?: string }>;
}) {
  const sp = await searchParams;
  return (
    <Container size="sm" className="py-10">
      <Card padding="lg" className="text-center">
        <h1 className="text-2xl font-bold mb-2">주문이 완료되었습니다</h1>
        {sp.orderNo ? (
          <p className="text-sm mb-6">
            주문번호 <span className="font-mono">{sp.orderNo}</span>
          </p>
        ) : null}
        <p className="text-sm text-muted-fg mb-8">
          주문 상세는 곧 발송되는 이메일에서 확인하실 수 있습니다.
        </p>
        <Link href="/">
          <Button variant="primary" size="lg">홈으로</Button>
        </Link>
      </Card>
    </Container>
  );
}
