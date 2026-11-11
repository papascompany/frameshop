/** 설정 화면 탭 — `/admin/settings?tab=<id>` 딥링크(런칭 점검 화면)용. */
export const SETTINGS_TABS = ['payment', 'notify', 'legal', 'social', 'misc'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function parseSettingsTab(value: string | undefined): SettingsTab {
  return SETTINGS_TABS.find((t) => t === value) ?? 'payment';
}

/**
 * 어드민 설정 삭제(unset) 허용 키 — 서버 액션 화이트리스트와 UI 삭제 버튼의
 * 단일 출처. 순수 데이터라 서버/클라이언트 양쪽에서 import 가능
 * ('use server' 파일은 async 함수만 export 할 수 있어 분리).
 *
 * 대상: env 폴백이 있는 결제·연동 키. 삭제하면 DB 행이 사라지고, 같은 역할의
 * 실값 환경변수가 있으면 그 값이, 없으면 미설정 상태로 동작한다.
 */
export const DELETABLE_SETTING_ENV_FALLBACK = {
  toss_client_key: 'NEXT_PUBLIC_TOSS_CLIENT_KEY',
  toss_secret_key: 'TOSS_SECRET_KEY',
  toss_webhook_secret: 'TOSS_WEBHOOK_SECRET',
  resend_api_key: 'RESEND_API_KEY',
  google_client_secret: 'GOOGLE_CLIENT_SECRET',
} as const;

export type DeletableSettingKey = keyof typeof DELETABLE_SETTING_ENV_FALLBACK;

export function isDeletableSettingKey(key: string): key is DeletableSettingKey {
  return Object.prototype.hasOwnProperty.call(DELETABLE_SETTING_ENV_FALLBACK, key);
}
