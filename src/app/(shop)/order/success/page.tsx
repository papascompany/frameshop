import Link from 'next/link';
import { cookies } from 'next/headers';
import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getOrder } from '@/lib/db/order';
import { groupOrderByGroupId } from '@/lib/order/grouping';
import { getServerSupabase } from '@/lib/supabase/server';
import { getTranslations } from 'next-intl/server';
import { OrderNoCopy } from './OrderNoCopy';

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

  const t = await getTranslations('order.success');

  // FS-X-04: 묶음 주문이면 그룹 요약 1줄("묶음 1 외 N개 상품")을 덧붙인다.
  // 로그인 회원 본인 주문일 때만 조회(비회원은 전화번호 검증 수단이 없어
  // 조회하지 않음) — 조회 실패/그룹 없음이면 현행 화면 그대로(최소 diff).
  let groupSummary: string | null = null;
  if (sp.orderNo && /^\d{8}-\d{4}$/.test(sp.orderNo) && userData.user) {
    try {
      const order = await getOrder(sp.orderNo);
      if (order && order.userId === userData.user.id) {
        const { groups, singles } = groupOrderByGroupId(order.items);
        const first = groups[0];
        if (first) {
          const others = groups.length - 1 + singles.length;
          groupSummary =
            others > 0
              ? `${first.key} 외 ${others}개 상품`
              : `${first.key} · ${first.lines.length}개 구성`;
        }
      }
    } catch {
      /* 조회 실패 → 요약 없이 현행 유지 */
    }
  }

  return (
    <Container size="sm" className="py-10">
      <Card padding="lg" className="text-center">
        <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
        {sp.orderNo ? (
          <p className="text-sm mb-4">
            {t('orderNo')} <OrderNoCopy orderNo={sp.orderNo} />
          </p>
        ) : null}
        {groupSummary ? (
          <p className="text-sm text-muted-fg mb-4" data-testid="success-group-summary">
            {groupSummary}
          </p>
        ) : null}

        {showGuestNotice ? (
          <div className="bg-soft-cloud rounded-lg p-4 mb-6 text-sm text-left">
            <p className="font-medium mb-1">{t('guestNotice')}</p>
            <p className="text-muted-fg">
              {t('guestLookupHint')}
            </p>
            <p className="mt-2 text-xs text-ink font-medium">
              ※ 비회원 주문은 주문번호로 조회합니다. 주문번호를 꼭 저장해 주세요.
            </p>
            <Link
              href={`/order/lookup${sp.orderNo ? `?orderNo=${sp.orderNo}` : ''}`}
              className="inline-block mt-3 text-ink underline underline-offset-2 font-medium"
            >
              {t('lookupLink')}
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-fg mb-8">
            {t('emailNotice')}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {!showGuestNotice && (
            <Link href="/account/orders">
              <Button variant="secondary" size="md">{t('viewOrders')}</Button>
            </Link>
          )}
          <Link href="/">
            <Button variant="primary" size="lg">{t('goHome')}</Button>
          </Link>
        </div>
      </Card>
    </Container>
  );
}
