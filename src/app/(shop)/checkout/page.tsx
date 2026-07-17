import { Container } from '@/components/layout/Container';
import { getShippingMethods } from '@/lib/db/shipping';
import {
  isCouponsAvailable,
  isPointsAvailable,
  isReceiptAvailable,
  isSurchargeAvailable,
} from '@/lib/db/feature-probe';
import { CheckoutClient } from './CheckoutClient';
import { getTranslations } from 'next-intl/server';

// FS-EC-01: feature-probe(60초 TTL)가 요청 시점에 실행되어야 마이그레이션
// 적용 시 재배포 없이 기능이 자동 활성화된다 — 빌드 시 고정 방지.
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  let methods: Awaited<ReturnType<typeof getShippingMethods>> = [];
  try {
    methods = await getShippingMethods();
  } catch (err) {
    console.warn('shipping methods fetch failed:', err);
  }
  // 마이그레이션 미적용/probe 실패 → false → 해당 섹션 비노출(graceful).
  const [points, receipt, surcharge, coupons] = await Promise.all([
    isPointsAvailable().catch(() => false),
    isReceiptAvailable().catch(() => false),
    isSurchargeAvailable().catch(() => false),
    // FS-X-04: 042 미적용이면 쿠폰 입력 카드 자체를 비노출(probe 게이트).
    isCouponsAvailable().catch(() => false),
  ]);
  const t = await getTranslations('checkout');
  return (
    <Container size="md" className="py-6 md:py-10">
      <h1 className="text-xl md:text-2xl font-bold mb-4">{t('title')}</h1>
      <CheckoutClient
        shippingMethods={methods}
        features={{ points, receipt, surcharge, coupons }}
      />
    </Container>
  );
}
