/**
 * /admin/coupons — 쿠폰 관리 (FS-X-05, ADR-026 / migration 042).
 *
 * probe 게이트: 042 미적용(배포~적용 창)이면 listCoupons 호출 없이 안내만
 * 노출한다 — 42P01 이 화면/로그로 새지 않는다(ADR-024 패턴). 적용되면 probe
 * 캐시 TTL(60초) 내 자동 활성화.
 */

import { requireAdmin } from '@/lib/db/admin';
import { listCoupons } from '@/lib/db/coupons';
import { isCouponsAvailable } from '@/lib/db/feature-probe';
import { CouponsClient } from './CouponsClient';

export const metadata = { title: '쿠폰 관리 · FrameShop Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminCouponsPage() {
  await requireAdmin();

  const available = await isCouponsAvailable();
  if (!available) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">쿠폰 관리</h1>
        </div>
        <p className="text-sm text-muted-fg border border-border rounded-card px-4 py-6 text-center">
          쿠폰 기능이 아직 활성화되지 않았습니다. 마이그레이션(042) 적용 후
          자동으로 사용할 수 있습니다.
        </p>
      </div>
    );
  }

  const { data: coupons, error } = await listCoupons();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">쿠폰 관리</h1>
        <p className="text-sm text-muted-fg mt-1">
          정액/정률 할인 쿠폰을 발급·관리합니다.
          {coupons ? ` (총 ${coupons.length}건)` : ''}
        </p>
      </div>
      {error || !coupons ? (
        <p role="alert" className="text-sm text-danger border border-danger rounded-md px-3 py-2">
          쿠폰 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <CouponsClient coupons={coupons} />
      )}
    </div>
  );
}
