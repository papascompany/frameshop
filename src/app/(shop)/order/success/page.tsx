import Link from 'next/link';
import { cookies } from 'next/headers';
import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getServerSupabase } from '@/lib/supabase/server';
import { getTranslations } from 'next-intl/server';

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

  return (
    <Container size="sm" className="py-10">
      <Card padding="lg" className="text-center">
        <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
        {sp.orderNo ? (
          <p className="text-sm mb-4">
            {t('orderNo')} <span className="font-mono font-medium">{sp.orderNo}</span>
          </p>
        ) : null}

        {showGuestNotice ? (
          <div className="bg-soft-cloud rounded-lg p-4 mb-6 text-sm text-left">
            <p className="font-medium mb-1">{t('guestNotice')}</p>
            <p className="text-muted-fg">
              {t('guestLookupHint')}
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
