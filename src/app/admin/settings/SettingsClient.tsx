'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { saveSettingsAction } from './actions';

// 탭 타입
type Tab = 'payment' | 'notify' | 'legal' | 'social' | 'misc';

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
    key: 'mail_from',
    label: '발신 이메일 주소',
    type: 'text',
    placeholder: 'FrameShop <noreply@도메인>',
    hint: 'Resend 에서 인증 완료된 도메인이어야 발송됩니다. 미설정 시 기본값(noreply@frameshop.kr) 사용.',
  },
  {
    key: 'slack_webhook_url',
    label: 'Slack 웹훅 URL',
    type: 'url',
    placeholder: 'https://hooks.slack.com/services/...',
    hint: '선택사항. 없으면 Slack 알림 비활성.',
  },
];

/**
 * 사업자·법적 고지 확정값 — 미입력 시 src/lib/legal/company.ts 정적값이 쓰인다.
 * 저장 즉시 Footer·/terms·/privacy 에 반영(캐시 태그 무효화).
 */
const LEGAL_SETTINGS: SettingMeta[] = [
  {
    key: 'company_email',
    label: '고객문의 이메일',
    type: 'email',
    placeholder: 'help@example.co.kr',
    hint: '개인정보처리방침 문의처로 표기됩니다. 미설정 시 "(확정 필요)" placeholder 가 그대로 노출됩니다.',
  },
  {
    key: 'company_mail_order_no',
    label: '통신판매업신고번호',
    type: 'text',
    placeholder: '2026-서울강남-00000',
    hint: 'Footer 사업자 정보에 표기. FrameShop 명의 신고번호 확정 후 입력하세요.',
  },
  {
    key: 'company_hosting',
    label: '호스팅 사업자 표기',
    type: 'text',
    placeholder: 'Vercel Inc.',
    hint: '실제 인프라 기준 표기(현재 정적 기본값은 "AWS").',
  },
  {
    key: 'company_courier',
    label: '배송 위탁사(택배사)',
    type: 'text',
    placeholder: 'CJ대한통운(주)',
    hint: '개인정보 처리위탁 조항의 배송사 항목에 반영됩니다.',
  },
  {
    key: 'legal_effective_date',
    label: '약관·방침 시행일',
    type: 'text',
    placeholder: '2026-09-01',
    hint: '법률 자문 완료 후 확정일 입력. 미설정 시 "초안 작성일" 표기가 유지됩니다.',
  },
  {
    key: 'legal_draft_notice_hidden',
    label: '초안 고지 배너 숨김',
    type: 'text',
    placeholder: 'true (숨김) / 비움 (표시)',
    hint: '법률 검토가 끝나면 true 를 입력해 /terms·/privacy 하단의 "법률 자문 전 초안입니다" 배너를 내립니다.',
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
    hint: '⚠️ 이 값은 참고용 기록입니다 — Sentry 는 빌드 시점 환경변수 NEXT_PUBLIC_SENTRY_DSN 으로만 활성화되므로 Vercel 환경변수에 등록 후 재배포해야 합니다.',
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
    { id: 'legal', label: '사업자·법적 고지' },
    { id: 'social', label: '소셜 연동' },
    { id: 'misc', label: '기타' },
  ];

  const sectionFields: Record<Tab, SettingMeta[]> = {
    payment: PAYMENT_SETTINGS,
    notify: NOTIFY_SETTINGS,
    legal: LEGAL_SETTINGS,
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
