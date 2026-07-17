'use client';

/**
 * 1:1 문의 작성 폼 (FS-X-06) — inquiryInputSchema 와 동일 규칙의 클라 검증
 * (subject 1..100 · body 1..2000 · email 형식/254자 · category 선택) 후
 * POST /api/account/inquiries. 성공 시 목록으로 이동.
 * 429(5건/시간 레이트리밋)·503(probe 미적용)은 구분된 안내를 노출한다.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

/**
 * 분류 값은 관리자 화면(admin/inquiries)이 그대로 읽는 자유 텍스트(DB spec:
 * '주문', '배송', '상품' 등) — 표시 라벨만 로케일화하고 저장 값은 고정한다.
 */
const CATEGORY_OPTIONS = [
  { value: '상품', labelKey: 'categoryProduct' },
  { value: '주문/결제', labelKey: 'categoryOrder' },
  { value: '배송', labelKey: 'categoryShipping' },
  { value: '기타', labelKey: 'categoryEtc' },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  /** 세션 이메일 — contactEmail 기본값(폼에서 변경 가능). */
  defaultEmail: string;
  /** 쿼리 프리필(서버에서 uuid 검증 완료). null = 참조 없음. */
  productId: string | null;
  orderId: string | null;
};

type FieldErrors = Partial<Record<'subject' | 'body' | 'contactEmail', string>>;

export function InquiryFormClient({ defaultEmail, productId, orderId }: Props) {
  const t = useTranslations('account.inquiries.form');
  const router = useRouter();

  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');
  const [contactEmail, setContactEmail] = useState(defaultEmail);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!subject.trim()) next.subject = t('subjectRequired');
    else if (subject.trim().length > 100) next.subject = t('subjectTooLong');
    if (!body.trim()) next.body = t('bodyRequired');
    else if (body.trim().length > 2000) next.body = t('bodyTooLong');
    const email = contactEmail.trim();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      next.contactEmail = t('emailInvalid');
    }
    return next;
  }

  async function handleSubmit(): Promise<void> {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/account/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          contactEmail: contactEmail.trim(),
          ...(category ? { category } : {}),
          ...(productId ? { productId } : {}),
          ...(orderId ? { orderId } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        code?: string;
      } | null;
      if (res.status === 429) {
        setSubmitError(t('rateLimited'));
        return;
      }
      if (res.status === 503 || data?.code === 'UNAVAILABLE') {
        setSubmitError(t('unavailable'));
        return;
      }
      if (!res.ok || !data?.ok) {
        setSubmitError(t('submitFailed'));
        return;
      }
      router.push('/account/inquiries');
    } catch {
      setSubmitError(t('submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card padding="md">
      <form
        className="space-y-4"
        // 네이티브 제약 검증(type=email)이 submit 이벤트를 삼키면 커스텀
        // 한국어 에러가 못 뜬다 — 검증 소스는 validate() 하나로 고정.
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        {productId ? (
          <p className="text-xs text-muted-fg" data-testid="inquiry-product-ref">
            {t('productRef')}
          </p>
        ) : null}
        {orderId ? (
          <p className="text-xs text-muted-fg" data-testid="inquiry-order-ref">
            {t('orderRef')}
          </p>
        ) : null}

        <Select
          label={t('category')}
          placeholder={t('categoryPlaceholder')}
          options={CATEGORY_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.labelKey),
          }))}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          data-testid="inquiry-category"
        />

        <Input
          label={t('subject')}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          error={errors.subject}
          maxLength={100}
          data-testid="inquiry-subject"
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="inquiry-body"
            className="text-sm font-medium text-foreground"
          >
            {t('body')}
          </label>
          <textarea
            id="inquiry-body"
            data-testid="inquiry-body"
            rows={6}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-invalid={errors.body ? true : undefined}
            className={
              'w-full bg-surface text-foreground placeholder:text-muted-fg ' +
              'border border-border rounded-input px-3 py-2.5 ' +
              'transition-colors duration-150 focus:outline-none focus:border-foreground' +
              (errors.body ? ' border-danger focus:border-danger' : '')
            }
          />
          {errors.body ? (
            <p className="text-xs text-danger">{errors.body}</p>
          ) : null}
        </div>

        <Input
          label={t('contactEmail')}
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          error={errors.contactEmail}
          autoComplete="email"
          maxLength={254}
          data-testid="inquiry-email"
        />

        {submitError ? (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() => router.push('/account/inquiries')}
          >
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={submitting}
            disabled={submitting}
            data-testid="inquiry-submit"
          >
            {t('submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
