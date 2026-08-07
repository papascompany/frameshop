'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { saveSettingsAction } from './actions';

// 탭 타입
type Tab = 'payment' | 'notify' | 'social' | 'misc';

type SettingMeta = {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'email' | 'url';
  placeholder?: string;
  hint?: string;
};

// 탭별 설정 정의
const PAYMENT_SETTINGS: SettingMeta[] = [
  {
    key: 'toss_client_key',
    label: 'Toss 클라이언트 키',
    type: 'text',
    placeholder: 'test_ck_... 또는 live_ck_...',
    hint: '결제 위젯 초기화에 사용됩니다 (공개 정보). 실값 환경변수가 있으면 env 우선, placeholder/미설정이면 이 값이 사용됩니다.',
  },
  {
    key: 'toss_secret_key',
    label: 'Toss 시크릿 키',
    type: 'password',
    placeholder: 'test_sk_... 또는 live_sk_...',
    hint: '서버 전용. 실값 환경변수 TOSS_SECRET_KEY가 있으면 env 우선, placeholder/미설정이면 이 값이 사용됩니다.',
  },
  {
    key: 'toss_webhook_secret',
    label: 'Toss 웹훅 시크릿',
    type: 'password',
    placeholder: '웹훅 검증 시크릿',
    hint: '서버 전용. 실값 환경변수 TOSS_WEBHOOK_SECRET가 있으면 env 우선, placeholder/미설정이면 이 값이 사용됩니다.',
  },
];

const NOTIFY_SETTINGS: SettingMeta[] = [
  {
    key: 'admin_email',
    label: '관리자 이메일',
    type: 'email',
    placeholder: 'admin@example.com',
    hint: '신규 주문 알림을 수신할 이메일 주소.',
  },
  {
    key: 'resend_api_key',
    label: 'Resend API 키',
    type: 'password',
    placeholder: 're_...',
    hint: '이메일 발송에 사용됩니다. 없으면 이메일 알림 비활성.',
  },
  {
    key: 'slack_webhook_url',
    label: 'Slack 웹훅 URL',
    type: 'url',
    placeholder: 'https://hooks.slack.com/services/...',
    hint: '선택사항. 없으면 Slack 알림 비활성.',
  },
];

const SOCIAL_SETTINGS: SettingMeta[] = [
  {
    key: 'google_client_id',
    label: 'Google OAuth Client ID',
    type: 'text',
    placeholder: '*.apps.googleusercontent.com',
    hint: 'Google Photos 연동에 필요. 없으면 Google Photos 기능 비활성.',
  },
  {
    key: 'google_client_secret',
    label: 'Google OAuth Client Secret',
    type: 'password',
    placeholder: 'GOCSPX-...',
    hint: '서버 전용.',
  },
];

const MISC_SETTINGS: SettingMeta[] = [
  {
    key: 'sentry_dsn',
    label: 'Sentry DSN',
    type: 'url',
    placeholder: 'https://...@o....ingest.sentry.io/...',
    hint: '오류 모니터링. 환경변수 NEXT_PUBLIC_SENTRY_DSN 설정도 필요합니다 (Vercel 환경변수).',
  },
];

type Props = {
  existing: Record<string, string>;
};

function SettingsSection({
  fields,
  existing,
  onSave,
}: {
  fields: SettingMeta[];
  existing: Record<string, string>;
  onSave: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave(values);
      setMessage({ ok: true, text: '저장되었습니다.' });
      setValues(Object.fromEntries(fields.map((f) => [f.key, ''])));
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : '저장 실패' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <label htmlFor={f.key} className="text-sm font-medium text-foreground">
            {f.label}
          </label>
          {existing[f.key] ? (
            <p className="text-xs text-muted-fg mb-1">
              현재 저장된 값: <span className="font-mono">****</span> (입력 시 덮어씁니다)
            </p>
          ) : null}
          <Input
            id={f.key}
            type={f.type ?? 'text'}
            placeholder={f.placeholder}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
          />
          {f.hint ? (
            <p className="text-xs text-muted-fg">{f.hint}</p>
          ) : null}
        </div>
      ))}

      {message ? (
        <p
          role="alert"
          className={`text-sm ${message.ok ? 'text-green-600' : 'text-red-600'}`}
        >
          {message.text}
        </p>
      ) : null}

      <Button type="submit" variant="primary" loading={saving} disabled={saving}>
        저장
      </Button>
    </form>
  );
}

export function SettingsClient({ existing }: Props) {
  const [tab, setTab] = useState<Tab>('payment');

  async function handleSave(values: Record<string, string>) {
    const result = await saveSettingsAction(values);
    if (!result.ok) {
      throw new Error(result.error ?? '저장 실패');
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'payment', label: '결제 설정' },
    { id: 'notify', label: '알림 설정' },
    { id: 'social', label: '소셜 연동' },
    { id: 'misc', label: '기타' },
  ];

  const sectionFields: Record<Tab, SettingMeta[]> = {
    payment: PAYMENT_SETTINGS,
    notify: NOTIFY_SETTINGS,
    social: SOCIAL_SETTINGS,
    misc: MISC_SETTINGS,
  };

  return (
    <div className="space-y-6">
      {/* 탭 */}
      <div className="flex gap-2 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-ink text-ink'
                : 'border-transparent text-muted-fg hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 섹션 */}
      <Card padding="md">
        <SettingsSection
          fields={sectionFields[tab]}
          existing={existing}
          onSave={handleSave}
        />
      </Card>
    </div>
  );
}
