'use client';

/**
 * 1:1 문의 목록 (FS-X-06) — 상태 배지(OPEN/ANSWERED/CLOSED) + 답변 표시.
 * 서버(page.tsx)가 조회한 목록을 그대로 렌더하는 표시 전용 클라 컴포넌트.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import type { Inquiry, InquiryStatus } from '@/types/inquiry';

type Props = {
  available: boolean;
  inquiries: Inquiry[];
};

const STATUS_VARIANT: Record<InquiryStatus, 'warning' | 'success' | 'default'> = {
  OPEN: 'warning',
  ANSWERED: 'success',
  CLOSED: 'default',
};

// KST 고정 포맷 — 서버(UTC)/클라(KST) 하이드레이션 불일치 방지(PointsClient 선례).
const dateFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function InquiriesClient({ available, inquiries }: Props) {
  const t = useTranslations('account.inquiries');
  const tStatus = useTranslations('account.inquiries.status');

  if (!available) {
    return (
      <Card padding="md">
        <p className="text-sm text-muted-fg">{t('unavailable')}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link
          href="/account/inquiries/new"
          className="inline-flex items-center justify-center h-10 px-4 text-sm font-medium rounded-[30px] bg-ink text-on-primary hover:bg-charcoal transition-colors"
          data-testid="inquiry-new-link"
        >
          {t('new')}
        </Link>
      </div>

      {inquiries.length === 0 ? (
        <div className="text-center py-16 text-muted-fg">
          <p className="text-sm">{t('empty')}</p>
          <p className="mt-2 text-xs">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="inquiries-list">
          {inquiries.map((inquiry) => (
            <li key={inquiry.id as string}>
              <Card padding="md" className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {inquiry.subject}
                    </p>
                    <p className="text-xs text-muted-fg mt-0.5">
                      {inquiry.category ? `${inquiry.category} · ` : ''}
                      {dateFmt.format(new Date(inquiry.createdAt))}
                    </p>
                  </div>
                  <Badge
                    variant={STATUS_VARIANT[inquiry.status]}
                    className="shrink-0"
                  >
                    {tStatus(inquiry.status)}
                  </Badge>
                </div>

                <p className="text-sm whitespace-pre-line text-foreground border-t border-border pt-3">
                  {inquiry.body}
                </p>

                {inquiry.adminReply ? (
                  <div
                    className="rounded-md bg-surface-muted p-3"
                    data-testid="inquiry-reply"
                  >
                    <p className="text-xs font-semibold text-muted-fg mb-1">
                      {t('reply')}
                    </p>
                    <p className="text-sm whitespace-pre-line text-foreground">
                      {inquiry.adminReply}
                    </p>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
