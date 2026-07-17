/**
 * /admin/inquiries — 1:1 문의 관리 (FS-X-05 UI, ADR-026 / migration 040).
 *
 * 목록 로드는 X-02 getAllInquiries(service-role — requireAdmin 선행)를 직접
 * 호출하고, 상태 필터는 URL(?status=)로 표현한다(탭 = Link, 서버 필터링).
 * probe 게이트: 040 미적용이면 조회 없이 안내만 노출(42P01 비노출).
 */

import Link from 'next/link';
import { requireAdmin } from '@/lib/db/admin';
import { getAllInquiries } from '@/lib/db/inquiries';
import { isInquiriesAvailable } from '@/lib/db/feature-probe';
import { cn } from '@/lib/cn';
import { INQUIRY_STATUSES } from '@/types/inquiry';
import type { InquiryStatus } from '@/types/inquiry';
import { InquiriesClient } from './InquiriesClient';

export const metadata = { title: '문의 관리 · FrameShop Admin' };
export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{ status?: string }>;
};

const STATUS_TABS: ReadonlyArray<{ value: InquiryStatus | null; label: string }> = [
  { value: null, label: '전체' },
  { value: 'OPEN', label: '답변대기' },
  { value: 'ANSWERED', label: '답변완료' },
  { value: 'CLOSED', label: '종료' },
];

export default async function AdminInquiriesPage({ searchParams }: Props) {
  await requireAdmin();

  const { status } = await searchParams;
  const statusFilter = (INQUIRY_STATUSES as readonly string[]).includes(
    status ?? '',
  )
    ? (status as InquiryStatus)
    : undefined;

  const available = await isInquiriesAvailable();
  if (!available) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">문의 관리</h1>
        </div>
        <p className="text-sm text-muted-fg border border-border rounded-card px-4 py-6 text-center">
          1:1 문의 기능이 아직 활성화되지 않았습니다. 마이그레이션(040) 적용 후
          자동으로 사용할 수 있습니다.
        </p>
      </div>
    );
  }

  const { data: inquiries, error } = await getAllInquiries(100, statusFilter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">문의 관리</h1>
        <p className="text-sm text-muted-fg mt-1">
          1:1 문의에 답변합니다. 답변 등록 시 고객에게 이메일이 발송됩니다.
          {inquiries ? ` (${inquiries.length}건)` : ''}
        </p>
      </div>

      {/* 상태 필터 탭 — URL 파라미터로 서버 필터링 */}
      <div className="flex gap-1 border-b border-border" role="tablist">
        {STATUS_TABS.map((tab) => {
          const active =
            tab.value === null ? statusFilter === undefined : statusFilter === tab.value;
          const href =
            tab.value === null
              ? '/admin/inquiries'
              : `/admin/inquiries?status=${tab.value}`;
          return (
            <Link
              key={tab.label}
              href={href}
              role="tab"
              aria-selected={active}
              className={cn(
                'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-fg hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {error || !inquiries ? (
        <p role="alert" className="text-sm text-danger border border-danger rounded-md px-3 py-2">
          문의 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <InquiriesClient inquiries={inquiries} />
      )}
    </div>
  );
}
