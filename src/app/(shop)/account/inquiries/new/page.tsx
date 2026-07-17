import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Container } from '@/components/layout/Container';
import { getServerSupabase } from '@/lib/supabase/server';
import { InquiryFormClient } from './InquiryFormClient';

export const dynamic = 'force-dynamic';

/**
 * 1:1 문의 작성 (FS-X-06).
 *  - ?productId= / ?orderId= 쿼리로 관련 상품/주문을 프리필(uuid 형식만 통과 —
 *    형식이 깨진 참조는 조용히 버려 POST 422 를 예방).
 *  - 연락 이메일 기본값은 세션 이메일(사용자가 폼에서 변경 가능).
 *  - 미로그인이면 쿼리를 보존한 채 로그인으로 리다이렉트.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewInquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; orderId?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    const qs = new URLSearchParams();
    if (sp.productId) qs.set('productId', sp.productId);
    if (sp.orderId) qs.set('orderId', sp.orderId);
    const query = qs.toString();
    const target = `/account/inquiries/new${query ? `?${query}` : ''}`;
    redirect(`/login?redirect=${encodeURIComponent(target)}`);
  }

  const productId =
    sp.productId && UUID_RE.test(sp.productId) ? sp.productId : null;
  const orderId = sp.orderId && UUID_RE.test(sp.orderId) ? sp.orderId : null;

  const t = await getTranslations('account.inquiries.form');

  return (
    <Container size="md" className="py-10">
      <h1 className="text-xl font-bold mb-6">{t('title')}</h1>
      <InquiryFormClient
        defaultEmail={userData.user.email ?? ''}
        productId={productId}
        orderId={orderId}
      />
    </Container>
  );
}
