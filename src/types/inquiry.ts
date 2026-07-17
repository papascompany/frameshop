/**
 * 1:1 문의(inquiries) 도메인 타입.
 *
 * DB 근거: migration 040. 결정: ADR-026 (FS-X-00 계약 동결).
 *
 * 정책(ADR-026): 문의는 전부 비공개(비밀글 고정) — 공개 SELECT 정책 없음.
 * 작성자 본인 + 관리자(service-role)만 읽는다. 비회원 문의는 user_id NULL 로
 * 서버 라우트(service-role)를 통해서만 생성/조회된다. contact_email 은 답변
 * 알림(notifyInquiryReplied) 수신처로 회원/비회원 공통 필수.
 *
 * 이 파일은 순수 타입 + zod 스키마만 담는다(클라/서버 공용, server-only 금지).
 *
 * FROZEN(옵셔널/추가 전용): 2026-07-17 by Architect (FS-X-00).
 */

import { z } from 'zod';
import type {
  InquiryId,
  IsoTimestamp,
  OrderId,
  ProductId,
  UserId,
} from './common';

// ---------- Enums / unions ----------

/** inquiries.status CHECK 와 1:1. OPEN → ANSWERED → (CLOSED). */
export const INQUIRY_STATUSES = ['OPEN', 'ANSWERED', 'CLOSED'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

// ---------- Domain types ----------

/** inquiries 1행 (camelCase 도메인 뷰). */
export type Inquiry = {
  id: InquiryId;
  /** NULL = 비회원 문의(서버 라우트 경유 생성). */
  userId: UserId | null;
  /** 주문 관련 문의면 참조(선택). 주문 삭제 시 SET NULL. */
  orderId: OrderId | null;
  /** 상품 관련 문의면 참조(선택). 상품 삭제 시 SET NULL. */
  productId: ProductId | null;
  /** 답변 알림 수신 이메일(회원/비회원 공통 필수). */
  contactEmail: string;
  /** 자유 분류('주문', '배송', '상품' 등). NULL = 미분류. */
  category: string | null;
  subject: string;
  body: string;
  status: InquiryStatus;
  /** 관리자 답변 본문. NULL = 미답변. */
  adminReply: string | null;
  answeredAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
};

// ---------- Zod schemas ----------

export const inquiryStatusSchema = z.enum(INQUIRY_STATUSES);

/**
 * 문의 작성 입력(/api/account/inquiries POST). userId 는 입력이 아니라 서버가
 * 세션에서 주입한다(스푸핑 방지). email 규칙은 ordererSchema 와 동일 계열.
 */
export const inquiryInputSchema = z.object({
  orderId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  contactEmail: z.string().email().max(254),
  category: z.string().min(1).max(30).optional(),
  subject: z.string().min(1).max(100),
  body: z.string().min(1).max(2000),
});

export type InquiryInput = z.infer<typeof inquiryInputSchema>;

/** 관리자 답변 입력(admin/inquiries actions). 답변 등록 시 status=ANSWERED. */
export const inquiryReplyInputSchema = z.object({
  reply: z.string().min(1).max(2000),
});

export type InquiryReplyInput = z.infer<typeof inquiryReplyInputSchema>;
