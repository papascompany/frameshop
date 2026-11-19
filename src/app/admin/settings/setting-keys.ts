/** 설정 화면 탭 — `/admin/settings?tab=<id>` 딥링크(런칭 점검 화면)용. */
export const SETTINGS_TABS = ['payment', 'notify', 'legal', 'social', 'misc'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function parseSettingsTab(value: string | undefined): SettingsTab {
  return SETTINGS_TABS.find((t) => t === value) ?? 'payment';
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * 어드민 설정 화면이 저장할 수 있는 키 — 저장 서버 액션 화이트리스트와 화면 조회의
 * 단일 출처. 여기 없는 키는 저장을 거부한다(임의 app_settings 행 생성 차단).
 * 순수 데이터라 서버/클라이언트 양쪽에서 import 가능('use server' 파일은 async 함수만
 * export 할 수 있어 분리).
 */
export const SETTABLE_SETTING_KEYS = [
  'toss_client_key',
  'toss_secret_key',
  'toss_webhook_secret',
  'admin_email',
  'resend_api_key',
  'mail_from',
  'slack_webhook_url',
  'google_client_id',
  'google_client_secret',
  'sentry_dsn',
  // 법적 고지 확정 대기 값(company.ts 정적값 오버라이드) — LEGAL_SETTING_KEYS 와 같은 집합.
  'company_email',
  'company_mail_order_no',
  'company_hosting',
  'company_courier',
  'legal_effective_date',
  'legal_draft_notice_hidden',
] as const;

export type SettableSettingKey = (typeof SETTABLE_SETTING_KEYS)[number];

export function isSettableSettingKey(key: string): key is SettableSettingKey {
  return (SETTABLE_SETTING_KEYS as readonly string[]).includes(key);
}

/** 설정값 길이 상한 — 키·URL·주소 문구에 충분하고, 설정 테이블을 통한 대용량 저장은 막는다. */
export const SETTING_VALUE_MAX_LENGTH = 2000;

/**
 * 삭제(unset)하면 환경변수로 폴백하는 결제·연동 키. 삭제하면 DB 행이 사라지고, 같은
 * 역할의 실값 환경변수가 있으면 그 값이, 없으면 미설정 상태로 동작한다.
 */
export const DELETABLE_SETTING_ENV_FALLBACK = {
  toss_client_key: 'NEXT_PUBLIC_TOSS_CLIENT_KEY',
  toss_secret_key: 'TOSS_SECRET_KEY',
  toss_webhook_secret: 'TOSS_WEBHOOK_SECRET',
  resend_api_key: 'RESEND_API_KEY',
  google_client_secret: 'GOOGLE_CLIENT_SECRET',
} as const;

export type EnvFallbackSettingKey = keyof typeof DELETABLE_SETTING_ENV_FALLBACK;

export function isEnvFallbackSettingKey(key: string): key is EnvFallbackSettingKey {
  return hasOwn(DELETABLE_SETTING_ENV_FALLBACK, key);
}

/**
 * 삭제하면 정적 기본값(src/lib/legal/company.ts)으로 돌아가는 법적 고지 값.
 * 저장 액션은 빈 입력을 "변경 없음"으로 무시하므로, 한 번 넣은 값(예: 초안 배너 숨김
 * `legal_draft_notice_hidden=true`)을 되돌리는 경로는 삭제뿐이다.
 * `LEGAL_SETTING_KEYS`(server-only 모듈)와 같은 집합 — 테스트가 일치를 고정한다.
 */
export const RESETTABLE_LEGAL_SETTING_KEYS = [
  'company_email',
  'company_mail_order_no',
  'company_hosting',
  'company_courier',
  'legal_effective_date',
  'legal_draft_notice_hidden',
] as const;

export type LegalResettableSettingKey = (typeof RESETTABLE_LEGAL_SETTING_KEYS)[number];

export function isLegalResettableSettingKey(key: string): key is LegalResettableSettingKey {
  return (RESETTABLE_LEGAL_SETTING_KEYS as readonly string[]).includes(key);
}

/** 어드민 설정 삭제(unset) 허용 키 — 서버 액션 화이트리스트와 UI 삭제 버튼의 단일 출처. */
export type DeletableSettingKey = EnvFallbackSettingKey | LegalResettableSettingKey;

export function isDeletableSettingKey(key: string): key is DeletableSettingKey {
  return isEnvFallbackSettingKey(key) || isLegalResettableSettingKey(key);
}

/** 삭제 확인 문구 — 삭제 후 어떤 값으로 동작하는지 키 종류별로 안내한다. */
export function describeSettingDeletion(key: string, label: string): string | null {
  if (isEnvFallbackSettingKey(key)) {
    return `${label} 저장값을 삭제합니다. 삭제 후에는 환경변수 ${DELETABLE_SETTING_ENV_FALLBACK[key]} 값이 있으면 그 값이, 없으면 미설정 상태로 동작합니다.`;
  }
  if (key === 'legal_draft_notice_hidden') {
    return `${label} 저장값을 삭제합니다. 삭제 후에는 /terms·/privacy 에 "법률 자문 전 초안" 배너가 다시 표시됩니다.`;
  }
  if (isLegalResettableSettingKey(key)) {
    return `${label} 저장값을 삭제합니다. 삭제 후에는 정적 기본 표기(src/lib/legal/company.ts)로 돌아갑니다.`;
  }
  return null;
}
