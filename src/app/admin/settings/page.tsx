import { requireAdmin } from '@/lib/db/admin';
import { getSettings } from '@/lib/db/settings';
import { SettingsClient } from './SettingsClient';

// 어드민 설정 페이지
export const metadata = { title: '시스템 설정 · FrameShop Admin' };

const ALL_KEYS = [
  'toss_client_key',
  'toss_secret_key',
  'toss_webhook_secret',
  'admin_email',
  'resend_api_key',
  'slack_webhook_url',
  'google_client_id',
  'google_client_secret',
  'sentry_dsn',
];

export default async function AdminSettingsPage() {
  await requireAdmin();

  // 값이 존재하는지 여부만 사용 (마스킹 표시용)
  const rawSettings = await getSettings(ALL_KEYS);
  // 값이 있으면 "exists" 마커, 없으면 빈 문자열 — 실제 비밀값은 클라이언트로 전달하지 않음
  const existing: Record<string, string> = {};
  for (const key of ALL_KEYS) {
    existing[key] = rawSettings[key] ? 'exists' : '';
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">시스템 설정</h1>
        <p className="text-sm text-muted-fg mt-1">
          결제·알림·소셜 연동 키를 관리합니다. 환경변수가 있으면 DB 설정보다 우선합니다.
        </p>
      </div>
      <SettingsClient existing={existing} />
    </div>
  );
}
