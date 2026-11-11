/**
 * 런칭 준비 점검 — 판정(순수 함수). 데이터 수집은 `collect.ts`(server-only).
 *
 * 남은 런칭 게이트는 대부분 운영자 입력이다(docs/BACKLOG.md §0). 이 모듈은
 * 수집된 스냅샷만 보고 항목별 상태(ok | warn | blocker | manual)와 한국어
 * 안내·고칠 곳을 만든다. I/O 없음 — 단위 테스트 대상.
 *
 * 비밀값 경계: 스냅샷에는 키 원문이 들어오지 않는다. Toss 키는 수집 단계에서
 * `describeTossKey` 로 모드/역할/출처만 남기고 값은 버린다.
 */

export type ReadinessStatus = 'ok' | 'warn' | 'blocker' | 'manual';

export type ReadinessGroup =
  | 'payment'
  | 'site'
  | 'shipping'
  | 'notify'
  | 'legal'
  | 'monitoring'
  | 'migrations'
  | 'hosting';

export type ReadinessItem = {
  id: string;
  group: ReadinessGroup;
  title: string;
  status: ReadinessStatus;
  message: string;
  details?: string[];
  /** 고칠 곳. href 가 없으면 어드민 밖(호스팅 환경변수 등)에서 처리. */
  fix?: { label: string; href?: string };
};

export type LaunchReadiness = {
  items: ReadinessItem[];
  summary: Record<ReadinessStatus, number>;
};

// ─── 스냅샷 계약 ─────────────────────────────────────────────────────────────

export type TossKeyMode = 'test' | 'live' | 'unknown';
/** Toss 키 종류 — `_ck_`/`_gck_` 는 클라이언트, `_sk_`/`_gsk_` 는 시크릿. */
export type TossKeyRole = 'client' | 'secret' | 'unknown';
export type SettingSource = 'env' | 'db';

export type TossKeyInfo =
  | { present: false }
  | { present: true; source: SettingSource; mode: TossKeyMode; role: TossKeyRole };

export type ShippingMethodSnapshot = {
  code: string;
  label: string;
  surchargeFeeJeju: number;
  surchargeFeeRemote: number;
};

export type MigrationProbeSnapshot = {
  /** 마이그레이션 번호(예: '043'). */
  migration: string;
  label: string;
  available: boolean;
};

export type LegalSnapshot = {
  email: string;
  mailOrderSalesNo: string;
  hosting: string;
  effectiveDate: string;
  processorNames: string[];
  /** 어드민에서 확정값을 입력했는지(정적값이 TODO 인 항목). */
  mailOrderOverridden: boolean;
  hostingOverridden: boolean;
  draftNoticeVisible: boolean;
};

export type LaunchSnapshot = {
  toss: {
    clientKey: TossKeyInfo;
    secretKey: TossKeyInfo;
    webhookSecretPresent: boolean;
  };
  /** NEXT_PUBLIC_SITE_URL 원값(미설정이면 null). */
  siteUrl: string | null;
  cronSecretPresent: boolean;
  /** null = 조회 실패. */
  shipping: { activeMethods: ShippingMethodSnapshot[] } | null;
  notify: { adminEmail: boolean; resendApiKey: boolean; mailFrom: boolean };
  legal: LegalSnapshot;
  sentryDsnPresent: boolean;
  migrations: MigrationProbeSnapshot[];
};

// ─── 보조 판정 ───────────────────────────────────────────────────────────────

/**
 * 키 원문 → 모드/역할만 남긴다(원문은 반환값에 포함하지 않음).
 * 빈 문자열·공백은 미설정.
 */
export function describeTossKey(
  value: string | null | undefined,
  source: SettingSource,
): TossKeyInfo {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { present: false };
  const modeMatch = /^(test|live)_/.exec(trimmed);
  const mode: TossKeyMode = modeMatch ? (modeMatch[1] as 'test' | 'live') : 'unknown';
  const role: TossKeyRole = /^(?:test|live)_g?ck_/.test(trimmed)
    ? 'client'
    : /^(?:test|live)_g?sk_/.test(trimmed)
      ? 'secret'
      : 'unknown';
  return { present: true, source, mode, role };
}

const MODE_LABEL: Record<TossKeyMode, string> = {
  test: '테스트 모드',
  live: '라이브 모드',
  unknown: '모드 확인 불가(접두사가 test_/live_ 가 아님)',
};

const SOURCE_LABEL: Record<SettingSource, string> = {
  env: '환경변수',
  db: '어드민 설정',
};

function describeKeyState(name: string, info: TossKeyInfo): string {
  if (!info.present) return `${name}: 미설정`;
  return `${name}: ${MODE_LABEL[info.mode]} (${SOURCE_LABEL[info.source]})`;
}

/**
 * 미적용이어도 기능이 동작하는 마이그레이션(043 웹훅 감사 로그 — 기록만 생략) → warn.
 * 그 외는 미적용 시 해당 기능이 꺼진다 → blocker.
 */
const OPTIONAL_MIGRATIONS: ReadonlySet<string> = new Set(['043']);

const PLACEHOLDER_MARK = '확정 필요';

const PAYMENT_FIX = { label: '설정 → 결제 설정', href: '/admin/settings?tab=payment' };
const NOTIFY_FIX = { label: '설정 → 알림 설정', href: '/admin/settings?tab=notify' };
const LEGAL_FIX = { label: '설정 → 사업자·법적 고지', href: '/admin/settings?tab=legal' };
const SHIPPING_FIX = { label: '배송 설정', href: '/admin/shipping' };
const ENV_FIX = { label: '호스팅 환경변수(변경 후 재배포)' };

function normalizeSiteUrl(raw: string | null): URL | null {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

// ─── 항목별 판정 ─────────────────────────────────────────────────────────────

function evaluateTossKeys(snapshot: LaunchSnapshot): ReadinessItem {
  const { clientKey, secretKey } = snapshot.toss;
  const details = [
    describeKeyState('클라이언트 키', clientKey),
    describeKeyState('시크릿 키', secretKey),
  ];
  const base = {
    id: 'toss-keys',
    group: 'payment' as const,
    title: 'Toss 결제 키',
    details,
    fix: PAYMENT_FIX,
  };

  if (!clientKey.present || !secretKey.present) {
    const missing = [
      !clientKey.present ? '클라이언트 키' : null,
      !secretKey.present ? '시크릿 키' : null,
    ].filter((v): v is string => v !== null);
    return {
      ...base,
      status: 'blocker',
      message: `${missing.join('·')} 미설정 — 체크아웃이 결제를 막고 주문이 생성되지 않습니다.`,
    };
  }
  if (clientKey.role === 'secret') {
    return {
      ...base,
      status: 'blocker',
      message:
        '클라이언트 키 자리에 시크릿 키 형식(_sk_)이 들어 있습니다. 클라이언트 키는 브라우저로 전달되므로 즉시 올바른 클라이언트 키로 교체하고, 노출된 시크릿 키는 재발급하세요.',
    };
  }
  if (secretKey.role === 'client') {
    return {
      ...base,
      status: 'blocker',
      message: '시크릿 키 자리에 클라이언트 키 형식(_ck_)이 들어 있습니다 — 결제 승인이 실패합니다.',
    };
  }
  if (
    clientKey.mode !== 'unknown' &&
    secretKey.mode !== 'unknown' &&
    clientKey.mode !== secretKey.mode
  ) {
    return {
      ...base,
      status: 'blocker',
      message:
        '두 키의 모드가 다릅니다(test_/live_ 접두사 불일치) — 결제 승인 시 NOT_FOUND_PAYMENT_SESSION 으로 실패합니다. 같은 상점·같은 모드의 키 한 쌍으로 맞추세요.',
    };
  }
  if (clientKey.mode === 'unknown' || secretKey.mode === 'unknown') {
    return {
      ...base,
      status: 'warn',
      message: '키 접두사(test_/live_)를 확인할 수 없어 모드 일치 여부를 판정하지 못했습니다. 개발자센터의 키를 그대로 붙여넣었는지 확인하세요.',
    };
  }
  return {
    ...base,
    status: 'ok',
    message:
      clientKey.mode === 'live'
        ? '라이브 모드 키 한 쌍이 설정되어 있습니다.'
        : '테스트 모드 키 한 쌍이 설정되어 있습니다 — 실제 청구는 일어나지 않습니다. 실판매 전 라이브 키로 교체하세요.',
  };
}

function evaluateTossWebhookSecret(snapshot: LaunchSnapshot): ReadinessItem {
  return {
    id: 'toss-webhook-secret',
    group: 'payment',
    title: 'Toss 웹훅 보안 키 (선택)',
    status: 'ok',
    message: snapshot.toss.webhookSecretPresent
      ? '설정됨 — 서명이 온 웹훅을 이 키로 추가 검증합니다. 개발자센터 웹훅 보안 키와 다르면 웹훅이 거부되니 일치하는지 확인하세요.'
      : '미설정(선택) — 웹훅 상태는 항상 Toss 결제 조회로 확인하므로 비워 둬도 됩니다.',
    fix: PAYMENT_FIX,
  };
}

function evaluateTossWebhookUrl(snapshot: LaunchSnapshot): ReadinessItem {
  const site = normalizeSiteUrl(snapshot.siteUrl);
  const base = site ? site.origin : '<사이트 URL>';
  return {
    id: 'toss-webhook-url',
    group: 'payment',
    title: 'Toss 웹훅 등록',
    status: 'manual',
    message:
      '등록 여부는 자동 확인할 수 없습니다. 토스페이먼츠 개발자센터 → 웹훅에서 아래 URL 을 등록하세요. 등록하지 않아도 결제는 되지만 Toss 대시보드 취소가 주문에 반영되지 않습니다.',
    details: [`URL: ${base}/api/webhook/payment`, '이벤트: PAYMENT_STATUS_CHANGED'],
  };
}

function evaluateSiteUrl(snapshot: LaunchSnapshot): ReadinessItem {
  const base = {
    id: 'site-url',
    group: 'site' as const,
    title: '사이트 URL (NEXT_PUBLIC_SITE_URL)',
    fix: ENV_FIX,
  };
  const raw = snapshot.siteUrl?.trim() ?? '';
  if (raw === '') {
    return {
      ...base,
      status: 'blocker',
      message: '미설정 — same-origin 검사로 주문·결제 등 변경 API 가 403 으로 거부되고, 결제 리다이렉트 URL 이 localhost 로 폴백합니다.',
    };
  }
  const url = normalizeSiteUrl(raw);
  if (!url) {
    return {
      ...base,
      status: 'blocker',
      message: `URL 형식이 아닙니다(${raw}) — same-origin 검사로 변경 API 가 403 으로 거부됩니다.`,
    };
  }
  if (url.protocol !== 'https:') {
    return {
      ...base,
      status: 'blocker',
      message: `https 가 아닙니다(${url.origin}) — 운영 도메인의 https 주소로 설정해야 same-origin 검사와 결제 리다이렉트가 동작합니다.`,
    };
  }
  return { ...base, status: 'ok', message: `${url.origin} (빌드 시점 값)` };
}

function evaluateCronSecret(snapshot: LaunchSnapshot): ReadinessItem {
  return {
    id: 'cron-secret',
    group: 'site',
    title: '크론 인증 (CRON_SECRET)',
    status: snapshot.cronSecretPresent ? 'ok' : 'blocker',
    message: snapshot.cronSecretPresent
      ? '설정됨.'
      : '미설정 — 운영 환경 크론이 401 로 거부되어 미확정 결제 스윕·렌더 재시도가 동작하지 않습니다.',
    fix: ENV_FIX,
  };
}

function evaluateShipping(snapshot: LaunchSnapshot): ReadinessItem[] {
  if (snapshot.shipping === null) {
    return [
      {
        id: 'shipping-methods',
        group: 'shipping',
        title: '배송 방법',
        status: 'manual',
        message: '배송 방법을 조회하지 못했습니다 — 배송 설정 화면에서 직접 확인하세요.',
        fix: SHIPPING_FIX,
      },
    ];
  }

  const active = snapshot.shipping.activeMethods;
  const methodsItem: ReadinessItem =
    active.length === 0
      ? {
          id: 'shipping-methods',
          group: 'shipping',
          title: '배송 방법',
          status: 'blocker',
          message: '활성 배송 방법이 없습니다 — 체크아웃에서 주문할 수 없습니다.',
          fix: SHIPPING_FIX,
        }
      : {
          id: 'shipping-methods',
          group: 'shipping',
          title: '배송 방법',
          status: 'ok',
          message: `활성 배송 방법 ${active.length}개: ${active.map((m) => m.label).join(', ')}`,
          fix: SHIPPING_FIX,
        };

  const standard = active.filter((m) => m.code === 'STANDARD');
  const zeroFees: string[] = [];
  for (const m of standard) {
    if (m.surchargeFeeJeju === 0) zeroFees.push(`${m.label}: 제주 추가배송비 0원`);
    if (m.surchargeFeeRemote === 0) zeroFees.push(`${m.label}: 도서산간 추가배송비 0원`);
  }
  const surchargeItem: ReadinessItem =
    standard.length === 0
      ? {
          id: 'shipping-surcharge',
          group: 'shipping',
          title: '제주·도서산간 추가배송비',
          status: 'ok',
          message: '택배(STANDARD) 배송이 비활성이라 해당 없습니다.',
          fix: SHIPPING_FIX,
        }
      : zeroFees.length > 0
        ? {
            id: 'shipping-surcharge',
            group: 'shipping',
            title: '제주·도서산간 추가배송비',
            status: 'warn',
            message: '추가배송비가 0원입니다 — 도서지역 배송 시 차액을 부담하게 됩니다.',
            details: zeroFees,
            fix: SHIPPING_FIX,
          }
        : {
            id: 'shipping-surcharge',
            group: 'shipping',
            title: '제주·도서산간 추가배송비',
            status: 'ok',
            message: '설정되어 있습니다.',
            fix: SHIPPING_FIX,
          };

  return [methodsItem, surchargeItem];
}

function evaluateNotify(snapshot: LaunchSnapshot): ReadinessItem {
  const { adminEmail, resendApiKey, mailFrom } = snapshot.notify;
  const missing: string[] = [];
  if (!adminEmail) missing.push('관리자 이메일 — 신규 주문 알림 수신처');
  if (!resendApiKey) missing.push('Resend API 키 — 없으면 이메일 알림 전체 비활성');
  if (!mailFrom) missing.push('발신 이메일 주소 — 기본값(noreply@frameshop.kr) 사용, Resend 도메인 인증 필요');
  return {
    id: 'notify-email',
    group: 'notify',
    title: '이메일 알림',
    status: missing.length > 0 ? 'warn' : 'ok',
    message:
      missing.length > 0
        ? '미설정 항목이 있습니다 — 주문은 정상 처리되지만 해당 알림이 발송되지 않습니다.'
        : '관리자 이메일·Resend 키·발신 주소가 설정되어 있습니다.',
    ...(missing.length > 0 ? { details: missing } : {}),
    fix: NOTIFY_FIX,
  };
}

function evaluateLegal(snapshot: LaunchSnapshot): ReadinessItem[] {
  const legal = snapshot.legal;
  const pending: string[] = [];
  if (legal.email.includes(PLACEHOLDER_MARK)) pending.push('고객문의 이메일');
  if (!legal.mailOrderOverridden) {
    pending.push('통신판매업신고번호 — FrameShop 명의 확정값 미입력(정적 기본값 사용 중)');
  } else if (legal.mailOrderSalesNo.includes(PLACEHOLDER_MARK)) {
    pending.push('통신판매업신고번호');
  }
  if (!legal.hostingOverridden) {
    pending.push(`호스팅 사업자 표기 — 확정값 미입력(정적 기본값 "${legal.hosting}")`);
  } else if (legal.hosting.includes(PLACEHOLDER_MARK)) {
    pending.push('호스팅 사업자 표기');
  }
  if (legal.effectiveDate.includes(PLACEHOLDER_MARK)) pending.push('약관·방침 시행일');
  for (const name of legal.processorNames) {
    if (name.includes(PLACEHOLDER_MARK)) {
      pending.push(
        name.startsWith('배송사')
          ? '개인정보 처리위탁: 배송사(택배사)'
          : `개인정보 처리위탁: ${name} — 코드(src/lib/legal/company.ts) 수정 필요`,
      );
    }
  }

  const companyItem: ReadinessItem = {
    id: 'legal-company',
    group: 'legal',
    title: '사업자 정보·법적 고지 확정값',
    status: pending.length > 0 ? 'warn' : 'ok',
    message:
      pending.length > 0
        ? `확정되지 않은 항목 ${pending.length}개 — Footer·약관·개인정보처리방침에 placeholder 가 노출됩니다(전자상거래법 표기 미비).`
        : '확정값이 모두 입력되어 있습니다.',
    ...(pending.length > 0 ? { details: pending } : {}),
    fix: LEGAL_FIX,
  };

  const draftItem: ReadinessItem = {
    id: 'legal-draft-notice',
    group: 'legal',
    title: '약관·방침 초안 고지',
    status: legal.draftNoticeVisible ? 'warn' : 'ok',
    message: legal.draftNoticeVisible
      ? '"법률 자문 전 초안" 배너가 /terms·/privacy 에 게시 중입니다. 법률 검토 완료 후 숨김 처리하세요.'
      : '초안 배너가 숨김 처리되어 있습니다.',
    fix: LEGAL_FIX,
  };

  return [companyItem, draftItem];
}

function evaluateSentry(snapshot: LaunchSnapshot): ReadinessItem {
  return {
    id: 'sentry-dsn',
    group: 'monitoring',
    title: '오류 모니터링 (Sentry)',
    status: snapshot.sentryDsnPresent ? 'ok' : 'warn',
    message: snapshot.sentryDsnPresent
      ? 'NEXT_PUBLIC_SENTRY_DSN 이 빌드에 포함되어 있습니다.'
      : 'NEXT_PUBLIC_SENTRY_DSN 이 없습니다 — 운영 오류가 수집되지 않습니다. 빌드 시점 환경변수라 어드민 설정이 아닌 호스팅 환경변수에 등록 후 재배포해야 합니다.',
    fix: ENV_FIX,
  };
}

function evaluateMigrations(snapshot: LaunchSnapshot): ReadinessItem {
  const missingRequired = snapshot.migrations.filter(
    (m) => !m.available && !OPTIONAL_MIGRATIONS.has(m.migration),
  );
  const missingOptional = snapshot.migrations.filter(
    (m) => !m.available && OPTIONAL_MIGRATIONS.has(m.migration),
  );
  const status: ReadinessStatus =
    missingRequired.length > 0 ? 'blocker' : missingOptional.length > 0 ? 'warn' : 'ok';
  const message =
    missingRequired.length > 0
      ? `미적용 마이그레이션 ${missingRequired.length}개 — 해당 기능이 꺼진 상태입니다.`
      : missingOptional.length > 0
        ? '필수 마이그레이션은 적용됨. 선택 항목(043 웹훅 감사 로그)이 미적용 — 웹훅 반영은 정상, 감사 기록만 생략됩니다.'
        : '점검 대상 마이그레이션이 모두 적용되어 있습니다.';
  return {
    id: 'migrations',
    group: 'migrations',
    title: 'DB 마이그레이션',
    status,
    message,
    details: snapshot.migrations.map(
      (m) => `${m.available ? '✓' : '✗'} ${m.migration} ${m.label}`,
    ),
  };
}

function evaluateHosting(): ReadinessItem {
  return {
    id: 'hosting-plan',
    group: 'hosting',
    title: '호스팅 플랜',
    status: 'manual',
    message:
      'Vercel Hobby 는 상업 이용 불가(결제 처리 = 상업). Pro 전환 또는 독립 서버(docs/setup/BAREMETAL_MIGRATION_RUNBOOK.md).',
  };
}

// ─── 진입점 ─────────────────────────────────────────────────────────────────

export function evaluateLaunchReadiness(snapshot: LaunchSnapshot): LaunchReadiness {
  const items: ReadinessItem[] = [
    evaluateTossKeys(snapshot),
    evaluateTossWebhookSecret(snapshot),
    evaluateTossWebhookUrl(snapshot),
    evaluateSiteUrl(snapshot),
    evaluateCronSecret(snapshot),
    ...evaluateShipping(snapshot),
    evaluateNotify(snapshot),
    ...evaluateLegal(snapshot),
    evaluateSentry(snapshot),
    evaluateMigrations(snapshot),
    evaluateHosting(),
  ];
  const summary: Record<ReadinessStatus, number> = { ok: 0, warn: 0, blocker: 0, manual: 0 };
  for (const item of items) summary[item.status] += 1;
  return { items, summary };
}
