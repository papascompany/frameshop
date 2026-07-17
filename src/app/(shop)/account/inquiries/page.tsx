import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Container } from '@/components/layout/Container';
import { getServerSupabase } from '@/lib/supabase/server';
import { isInquiriesAvailable } from '@/lib/db/feature-probe';
import { listMyInquiries } from '@/lib/db/inquiries';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import type { Inquiry } from '@/types/inquiry';
import { InquiriesClient } from './InquiriesClient';

export const dynamic = 'force-dynamic';

/**
 * 1:1 문의 마이페이지 (FS-X-06, ADR-026).
 * graceful: migration 040 미적용(probe false)이면 스키마 쿼리 없이 안내만
 * 렌더 — 페이지가 죽지 않는다(points/addresses 폴백과 동일 원칙).
 */
export default async function InquiriesPage() {
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect('/login?redirect=/account/inquiries');
  }

  const available = await isInquiriesAvailable().catch(() => false);

  let inquiries: Inquiry[] = [];
  if (available) {
    const { data, error } = await listMyInquiries(
      asBrand<UserId>(userData.user.id),
    );
    if (!error && data) inquiries = data;
  }

  const t = await getTranslations('account.inquiries');

  return (
    <Container size="md" className="py-10">
      <h1 className="text-xl font-bold mb-6">{t('title')}</h1>
      <InquiriesClient available={available} inquiries={inquiries} />
    </Container>
  );
}
