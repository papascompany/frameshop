'use client';

/**
 * 1:1 문의 관리 클라이언트 (FS-X-05, ADR-026 / migration 040).
 *
 * 목록(제목/카테고리/상태 배지/작성일) + 행 펼침(본문·연락 이메일·주문/상품
 * 링크) + 답변 textarea. 답변 제출은 X-02 replyInquiryAction 에 위임하고,
 * 성공 시 로컬 상태만 갱신한다(ReviewsClient 낙관 업데이트 패턴 — 새로고침
 * 없이 상태 배지/답변이 즉시 반영).
 */

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { Inquiry, InquiryStatus } from '@/types/inquiry';
import { replyInquiryAction } from './actions';

// ---------- 순수 헬퍼 (테스트용 export) ----------

type BadgeVariant = 'default' | 'success' | 'warning';

/** 상태 → 배지 라벨/변형 매핑 (순수 함수). */
export function inquiryStatusBadge(status: InquiryStatus): {
  label: string;
  variant: BadgeVariant;
} {
  switch (status) {
    case 'OPEN':
      return { label: '답변대기', variant: 'warning' };
    case 'ANSWERED':
      return { label: '답변완료', variant: 'success' };
    case 'CLOSED':
      return { label: '종료', variant: 'default' };
  }
}

// ---------- 컴포넌트 ----------

/** 낙관 업데이트 오버레이 — 답변 성공 시 서버 재조회 없이 행에 반영한다. */
type ReplyOverride = { adminReply: string; status: 'ANSWERED' };

type Props = { inquiries: Inquiry[] };

export function InquiriesClient({ inquiries }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, ReplyOverride>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleReply(inquiry: Inquiry) {
    const id = inquiry.id as string;
    const text = (drafts[id] ?? '').trim();
    if (text.length === 0) {
      setErrors((prev) => ({ ...prev, [id]: '답변 내용을 입력해주세요.' }));
      return;
    }

    setSubmittingId(id);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    const result = await replyInquiryAction(id, text);
    if (result.ok) {
      setOverrides((prev) => ({
        ...prev,
        [id]: { adminReply: text, status: 'ANSWERED' },
      }));
      // 제출된 초안은 비운다 — 등록된 답변 블록이 최신 내용을 보여준다.
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else {
      setErrors((prev) => ({
        ...prev,
        [id]: result.error ?? '답변 등록에 실패했습니다.',
      }));
    }
    setSubmittingId(null);
  }

  if (inquiries.length === 0) {
    return (
      <p className="text-sm text-muted-fg text-center py-8">
        문의가 없습니다.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {inquiries.map((inquiry) => {
        const id = inquiry.id as string;
        const override = overrides[id];
        const status = override?.status ?? inquiry.status;
        const adminReply = override?.adminReply ?? inquiry.adminReply;
        const badge = inquiryStatusBadge(status);
        const expanded = expandedId === id;
        const submitting = submittingId === id;
        const error = errors[id];

        return (
          <li key={id}>
            <Card padding="md" className="space-y-3">
              {/* 요약 행 — 클릭으로 펼침 토글 */}
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : id)}
                aria-expanded={expanded}
                className="w-full text-left flex items-start justify-between gap-3"
                data-testid="inquiry-row-toggle"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium truncate">{inquiry.subject}</p>
                  <p className="text-xs text-muted-fg">
                    {inquiry.category ? `${inquiry.category} · ` : ''}
                    {new Date(inquiry.createdAt).toLocaleString('ko-KR')}
                  </p>
                </div>
                <Badge variant={badge.variant} className="shrink-0">
                  {badge.label}
                </Badge>
              </button>

              {/* 펼침 — 본문 · 연락 이메일 · 참조 링크 · 답변 */}
              {expanded ? (
                <div className="border-t border-border pt-3 space-y-3">
                  <p className="text-sm whitespace-pre-wrap">{inquiry.body}</p>

                  <dl className="text-xs text-muted-fg space-y-1">
                    <div className="flex gap-2">
                      <dt>연락 이메일:</dt>
                      <dd className="font-mono">{inquiry.contactEmail}</dd>
                    </div>
                    {inquiry.userId == null ? (
                      <div className="flex gap-2">
                        <dt>작성자:</dt>
                        <dd>비회원</dd>
                      </div>
                    ) : null}
                  </dl>

                  {(inquiry.orderId || inquiry.productId) && (
                    <div className="flex flex-wrap gap-3">
                      {inquiry.orderId ? (
                        <Link
                          href={`/admin/orders/${inquiry.orderId as string}`}
                          className="text-xs text-accent hover:underline"
                        >
                          관련 주문 보기
                        </Link>
                      ) : null}
                      {inquiry.productId ? (
                        <Link
                          href={`/admin/products/${inquiry.productId as string}`}
                          className="text-xs text-accent hover:underline"
                        >
                          관련 상품 보기
                        </Link>
                      ) : null}
                    </div>
                  )}

                  {adminReply ? (
                    <div className="bg-surface-muted border border-border rounded-md px-3 py-2">
                      <p className="text-xs font-medium text-muted-fg mb-1">
                        등록된 답변
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{adminReply}</p>
                    </div>
                  ) : null}

                  {/* 답변 작성/수정 — 재답변도 같은 경로(OPEN→ANSWERED) */}
                  <div className="space-y-2">
                    <label
                      htmlFor={`reply-${id}`}
                      className="text-sm font-medium"
                    >
                      {adminReply ? '답변 수정' : '답변 작성'}
                    </label>
                    <textarea
                      id={`reply-${id}`}
                      value={drafts[id] ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                      rows={4}
                      maxLength={2000}
                      disabled={submitting}
                      placeholder="고객에게 전송될 답변을 입력하세요. (등록 시 이메일 알림)"
                      className="w-full border border-border rounded-input px-3 py-2 text-sm resize-y bg-surface focus:outline-none focus:border-foreground disabled:opacity-50"
                    />
                    {error ? (
                      <p role="alert" className="text-sm text-danger">
                        {error}
                      </p>
                    ) : null}
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        loading={submitting}
                        disabled={submitting}
                        onClick={() => void handleReply(inquiry)}
                      >
                        답변 등록
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
