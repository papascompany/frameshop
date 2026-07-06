import { cookies } from 'next/headers';
import { Container } from '@/components/layout/Container';
import { getProductDetail, getProductOptions } from '@/lib/db/product';
import { getActiveStockPhotos } from '@/lib/db/stock-photos';
import { getSetting } from '@/lib/db/settings';
import { getServerSupabase } from '@/lib/supabase/server';
import { parseStudioPreselect } from '@/lib/wall/deeplink';
import { asBrand } from '@/types/common';
import type { ProductId } from '@/types/common';
import type { EditorKind } from '@/types/editor';
import { StudioClient } from './StudioClient';

const GUEST_COOKIE_NAME = 'fs-guest-sid';

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{
    productId?: string;
    size?: string;
    color?: string;
    orientation?: string;
    mode?: string;
  }>;
}) {
  const { orderId } = await params;
  const { productId, size, color, orientation, mode } = await searchParams;
  // FS-EC-04: optional deep-link preselect (포토월 → 스튜디오). null when the
  // params are absent → StudioClient behaves exactly as before.
  const preselect = parseStudioPreselect({ size, color, orientation });
  // FS-P1-03 (ADR-025): `?mode=multi` → 확장형(멀티포토) 편집 세션. 그 외 모든
  // 값/부재는 'basic' — 현행 단품 편집기와 완전 동일.
  const editorKind: EditorKind = mode === 'multi' ? 'extended' : 'basic';

  // Resolve the effective sessionId:
  //   - For authenticated users: use the Supabase user ID (set upstream).
  //   - For guests: use the `fs-guest-sid` HttpOnly cookie issued by middleware.
  //   - Fallback: use the orderId URL segment (legacy behaviour).
  const supabase = await getServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const cookieStore = await cookies();
  const guestSid = cookieStore.get(GUEST_COOKIE_NAME)?.value ?? null;
  const effectiveSessionId =
    userData.user?.id ?? guestSid ?? orderId;

  if (!productId) {
    return (
      <Container size="md" className="py-10">
        <p className="text-sm text-muted-fg">상품 정보가 없습니다.</p>
      </Container>
    );
  }

  let detail: Awaited<ReturnType<typeof getProductDetail>> = null;
  let options: Awaited<ReturnType<typeof getProductOptions>> | null = null;

  try {
    [detail, options] = await Promise.all([
      getProductDetail(asBrand<ProductId>(productId)),
      getProductOptions(asBrand<ProductId>(productId)),
    ]);
  } catch (err) {
    console.warn('studio data fetch failed:', err);
  }

  if (!detail || !options) {
    return (
      <Container size="md" className="py-10">
        <p className="text-sm text-muted-fg">상품을 불러올 수 없습니다.</p>
      </Container>
    );
  }

  // 명화 갤러리 + Google Photos 활성화 여부 (병렬 fetch)
  const [artworks, googleClientId] = await Promise.all([
    getActiveStockPhotos().catch(() => []),
    getSetting('google_client_id').catch(() => null),
  ]);
  const googlePhotosEnabled =
    !!(process.env.GOOGLE_CLIENT_ID ?? googleClientId);

  return (
    <StudioClient
      sessionId={effectiveSessionId}
      productDetail={detail}
      options={options}
      artworks={artworks}
      googlePhotosEnabled={googlePhotosEnabled}
      preselect={preselect}
      kind={editorKind}
    />
  );
}
