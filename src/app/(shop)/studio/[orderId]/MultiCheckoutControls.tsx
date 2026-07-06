'use client';

/**
 * 확장형(멀티포토) 묶음 담기 컨트롤 — FS-P1-03 (ADR-025).
 *
 * StudioClient 본문은 i18n 미사용(현행 하드코딩 한국어 유지 — 베이직 회귀 0)이라,
 * extended 전용 CTA/스티키 바 콘텐츠만 이 파일에서 next-intl 로 렌더한다.
 * kind:'extended' 에서만 마운트된다.
 */

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { PriceTag } from '@/components/PriceTag';

type CheckoutButtonProps = {
  /** 담길 라인 수(트레이 + 편집 중 자동 포함 사진). */
  count: number;
  confirming: boolean;
  disabled: boolean;
  onClick: () => void;
  className?: string;
  'data-testid'?: string;
};

export function MultiCheckoutButton({
  count,
  confirming,
  disabled,
  onClick,
  className,
  'data-testid': testId = 'multi-checkout',
}: CheckoutButtonProps) {
  const t = useTranslations('studio');
  return (
    <Button
      variant="primary"
      size="lg"
      disabled={disabled}
      onClick={onClick}
      className={className}
      data-testid={testId}
    >
      {confirming ? t('confirming') : t('multiCheckout', { count })}
    </Button>
  );
}

/** 모바일 스티키 바 콘텐츠(합계 + N개 라인 담기) — MobileStickyBar 안에서 렌더. */
export function MultiStickyBarContent({
  totalQuantity,
  totalPrice,
  unitPrice,
  count,
  confirming,
  disabled,
  onClick,
}: {
  totalQuantity: number;
  totalPrice: number;
  /** 트레이가 비어 있을 때 표시할 낱장 단가(현행 basic 스티키와 동일 규칙). */
  unitPrice: number;
  count: number;
  confirming: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const t = useTranslations('studio');
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0">
        <p className="text-[11px] text-mute leading-none mb-0.5">
          {totalQuantity > 0
            ? t('multiTotalQuantity', { count: totalQuantity })
            : t('multiUnitPrice')}
        </p>
        <PriceTag
          amount={totalQuantity > 0 ? totalPrice : unitPrice}
          variant="large"
        />
      </div>
      <MultiCheckoutButton
        count={count}
        confirming={confirming}
        disabled={disabled}
        onClick={onClick}
        className="ml-auto"
        data-testid="multi-checkout-sticky"
      />
    </div>
  );
}

/** 옵션 패널 위 안내 — extended 에선 전역 옵션이 "새 라인 기본값"임을 설명. */
export function MultiOptionsHint() {
  const t = useTranslations('studio');
  return <p className="text-xs text-muted-fg">{t('multiOptionsHint')}</p>;
}

/**
 * 묶음 담기 차단 사유(FS-P1-final P1-002/P2-002). 재크롭 필요 라인이 우선,
 * 그다음 비활성 조합 라인. 둘 다 없으면 렌더하지 않는다. StudioClient 본문은
 * i18n 미사용(하드코딩 한국어)이라 extended 전용 사유만 여기서 next-intl 로 렌더.
 */
export function MultiCheckoutBlockedReason({
  recropCount,
  unavailable,
}: {
  /** 기하 변경(재편집 권장) 라인 수 — LineList 가 보고한 값. */
  recropCount: number;
  /** 비활성 옵션 조합 라인 존재 여부(!allLinesAvailable). */
  unavailable: boolean;
}) {
  const t = useTranslations('studio');
  if (recropCount <= 0 && !unavailable) return null;
  return (
    <p
      role="alert"
      data-testid="multi-blocked-reason"
      className="text-xs text-red-600"
    >
      {recropCount > 0
        ? t('multiRecropBlocked', { count: recropCount })
        : t('multiUnavailableBlocked')}
    </p>
  );
}
