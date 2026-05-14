import Link from 'next/link';
import { cookies } from 'next/headers';
import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getServerSupabase } from '@/lib/supabase/server';

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ orderNo?: string }>;
}) {
  const sp = await searchParams;

  // Determine if the current visitor is a guest (not logged in).
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const isGuest = !userData.user;

  // Confirm the guest cookie exists (issued by middleware on checkout).
  const cookieStore = await cookies();
  const hasGuestCookie = !!cookieStore.get('fs-guest-sid');
  const showGuestNotice = isGuest && hasGuestCookie;

  return (
    <Container size="sm" className="py-10">
      <Card padding="lg" className="text-center">
        <h1 className="text-2xl font-bold mb-2">주문이 완료되었습니다</h1>
        {sp.orderNo ? (
          <p className="text-sm mb-4">
            주문번호 <span className="font-mono font-medium">{sp.orderNo}</span>
          </p>
        ) : null}

        {showGuestNotice ? (
          <div className="bg-soft-cloud rounded-lg p-4 mb-6 text-sm text-left">
            <p className="font-medium mb-1">비회원 주문이 완료되었습니다.</p>
            <p className="text-muted-fg">
              주문 내역은 주문번호와 전화번호로 언제든지 조회하실 수 있습니다.
            </p>
            <Link
              href={`/order/lookup${sp.orderNo ? `?orderNo=${sp.orderNo}` : ''}`}
              className="inline-block mt-3 text-ink underline underline-offset-2 font-medium"
            >
              주문 조회하기
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-fg mb-8">
            주문 상세는 곧 발송되는 이메일에서 확인하실 수 있습니다.
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {!showGuestNotice && (
            <Link href="/account/orders">
              <Button variant="secondary" size="md">주문 내역 보기</Button>
            </Link>
          )}
          <Link href="/">
            <Button variant="primary" size="lg">홈으로</Button>
          </Link>
        </div>
      </Card>
    </Container>
  );
}
