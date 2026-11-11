/**
 * 런칭 준비 점검 — 데이터 수집(server-only). 판정은 `readiness.ts`(순수).
 *
 * 비밀값 경계: Toss 키·CRON_SECRET·Resend 키 등은 이 모듈 안에서 존재 여부/
 * 모드만 뽑고 원문은 스냅샷에 넣지 않는다 — 페이지(RSC)로 값이 흘러가지 않는다.
 *
 * Toss 키 해석은 `src/lib/env.ts` 의 getEffectiveToss* 와 같은 우선순위
 * (실값 env → placeholder/미설정이면 app_settings)를 따른다.
 */

import 'server-only';
import { env } from '@/lib/env';
import { getSettings } from '@/lib/db/settings';
import { listShippingMethods } from '@/lib/db/shipping';
import {
  isBundleRulesAvailable,
  isConfirmAvailable,
  isCouponOrderLedgerAvailable,
  isCouponsAvailable,
  isInquiriesAvailable,
  isPartialRefundAvailable,
  isPointsAvailable,
  isProjectCartAvailable,
  isReceiptAvailable,
  isSetTemplatesAvailable,
  isSurchargeAvailable,
  isWebhookAuditAvailable,
  isWishlistAvailable,
} from '@/lib/db/feature-probe';
import { getLegalInfo } from '@/lib/legal/company-settings';
import {
  describeTossKey,
  type LaunchSnapshot,
  type MigrationProbeSnapshot,
  type ShippingMethodSnapshot,
  type TossKeyInfo,
} from './readiness';

/** feature-probe 전부 — 마이그레이션 번호 순. */
const MIGRATION_PROBES: ReadonlyArray<{
  migration: string;
  label: string;
  probe: () => Promise<boolean>;
}> = [
  { migration: '030', label: '도서산간 추가 배송비', probe: isSurchargeAvailable },
  { migration: '031', label: '적립금', probe: isPointsAvailable },
  { migration: '033', label: '구매확정', probe: isConfirmAvailable },
  { migration: '034·035', label: '확장형 묶음 카트 동기화', probe: isProjectCartAvailable },
  { migration: '036', label: '세트 템플릿', probe: isSetTemplatesAvailable },
  { migration: '037', label: '구성 규칙', probe: isBundleRulesAvailable },
  { migration: '038', label: '부분환불', probe: isPartialRefundAvailable },
  { migration: '039', label: '현금영수증', probe: isReceiptAvailable },
  { migration: '040', label: '1:1 문의', probe: isInquiriesAvailable },
  { migration: '041', label: '위시리스트', probe: isWishlistAvailable },
  { migration: '042', label: '쿠폰', probe: isCouponsAvailable },
  { migration: '043', label: '웹훅 수신 감사 로그', probe: isWebhookAuditAvailable },
  { migration: '045', label: '쿠폰 주문 연결(병렬 주문 차단)', probe: isCouponOrderLedgerAvailable },
];

const SETTING_KEYS = [
  'toss_client_key',
  'toss_secret_key',
  'toss_webhook_secret',
  'admin_email',
  'resend_api_key',
  'mail_from',
  'company_mail_order_no',
  'company_hosting',
] as const;

function hasValue(value: string | null | undefined): boolean {
  return value != null && value.trim() !== '';
}

function resolveTossKey(envValue: string | undefined, dbValue: string | undefined): TossKeyInfo {
  if (envValue) return describeTossKey(envValue, 'env');
  return describeTossKey(dbValue, 'db');
}

/**
 * 호스팅 환경변수 존재 여부/원값(공개값만). env.ts 에 getter 가 없는 항목만
 * 여기서 읽는다 — NEXT_PUBLIC_* 는 리터럴 정적 접근(빌드 시점 인라인 대상).
 */
function readHostingEnv(): {
  siteUrl: string | null;
  sentryDsnPresent: boolean;
  cronSecretPresent: boolean;
} {
  return {
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    sentryDsnPresent: hasValue(process.env.NEXT_PUBLIC_SENTRY_DSN),
    cronSecretPresent: hasValue(process.env.CRON_SECRET),
  };
}

async function collectShipping(): Promise<LaunchSnapshot['shipping']> {
  try {
    const methods = await listShippingMethods();
    const activeMethods: ShippingMethodSnapshot[] = methods
      .filter((m) => m.isActive)
      .map((m) => ({
        code: m.code,
        label: m.label,
        surchargeFeeJeju: m.surchargeFeeJeju ?? 0,
        surchargeFeeRemote: m.surchargeFeeRemote ?? 0,
      }));
    return { activeMethods };
  } catch (err) {
    console.error(
      '[launch] shipping methods lookup failed:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

async function collectMigrations(): Promise<MigrationProbeSnapshot[]> {
  return Promise.all(
    MIGRATION_PROBES.map(async ({ migration, label, probe }) => ({
      migration,
      label,
      available: await probe().catch((): boolean => false),
    })),
  );
}

export async function collectLaunchSnapshot(): Promise<LaunchSnapshot> {
  const [settings, shipping, migrations, legalInfo] = await Promise.all([
    getSettings([...SETTING_KEYS]),
    collectShipping(),
    collectMigrations(),
    getLegalInfo(),
  ]);

  // notify/index.ts 와 같은 우선순위: RESEND_API_KEY env → app_settings.
  const resendApiKey = env.resendApiKey() ?? settings['resend_api_key'];

  return {
    toss: {
      clientKey: resolveTossKey(env.tossClientKeyOptional(), settings['toss_client_key']),
      secretKey: resolveTossKey(env.tossSecretKeyOptional(), settings['toss_secret_key']),
      webhookSecretPresent:
        hasValue(env.tossWebhookSecretOptional()) || hasValue(settings['toss_webhook_secret']),
    },
    ...readHostingEnv(),
    shipping,
    notify: {
      adminEmail: hasValue(settings['admin_email']),
      resendApiKey: hasValue(resendApiKey),
      mailFrom: hasValue(settings['mail_from']),
    },
    legal: {
      email: legalInfo.company.email,
      mailOrderSalesNo: legalInfo.company.mailOrderSalesNo,
      hosting: legalInfo.company.hosting,
      effectiveDate: legalInfo.effectiveDate,
      processorNames: legalInfo.processors.map((p) => p.name),
      mailOrderOverridden: hasValue(settings['company_mail_order_no']),
      hostingOverridden: hasValue(settings['company_hosting']),
      draftNoticeVisible: legalInfo.draftNotice !== null,
    },
    migrations,
  };
}
