import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Container } from '@/components/layout/Container';
import { getServerSupabase } from '@/lib/supabase/server';
import { isWishlistAvailable } from '@/lib/db/feature-probe';
import { listWishlist, type WishlistEntry } from '@/lib/db/wishlists';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';
import { WishlistClient } from './WishlistClient';

export const dynamic = 'force-dynamic';

/**
 * 위시리스트 마이페이지 (FS-X-06, ADR-026 — 로그인 전용).
 * graceful: migration 041 미적용(probe false)이면 스키마 쿼리 없이 안내만
 * 렌더 — 페이지가 죽지 않는다(points 페이지의 031 폴백과 동일 원칙).
 */
export default async function WishlistPage() {
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect('/login?redirect=/account/wishlist');
  }

  const available = await isWishlistAvailable().catch(() => false);

  let items: WishlistEntry[] = [];
  if (available) {
    const { data, error } = await listWishlist(asBrand<UserId>(userData.user.id));
    if (!error && data) items = data;
  }

  const t = await getTranslations('account.wishlist');

  return (
    <Container size="md" className="py-10">
      <h1 className="text-xl font-bold mb-6">{t('title')}</h1>
      <WishlistClient available={available} initialItems={items} />
    </Container>
  );
}
