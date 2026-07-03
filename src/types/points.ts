/**
 * Reward points (적립금) contract — 1 point = 1 KRW, 정수.
 *
 * DB 근거: migration 031 (user_profiles.points_balance = 차감의 권위,
 * user_points_ledger = 불변 원장, apply_points_transaction RPC = 원자 갱신).
 * orders.points_redeemed / points_accrued 는 주문 스냅샷이며, orders.total_price
 * 는 redeem 을 **이미 차감한 최종 금액**으로 저장한다(031 주석 — confirm.ts 의
 * totalPrice === amount 검증을 변경 없이 유지).
 *
 * 이 파일은 순수 타입 + 순수 함수만 담는다(클라/서버 공용, server-only 금지).
 * RPC 호출·잔액 조회 등 IO 는 Backend 구현 에이전트 소유.
 *
 * FROZEN: 2026-07-03 by Architect (FS-EC-00).
 */

import { z } from 'zod';
import type { IsoTimestamp, OrderId, UserId } from './common';

// ---------- Ledger ----------

/** migration 031 user_points_ledger.transaction_type CHECK 와 1:1. */
export const POINTS_TRANSACTION_TYPES = [
  'ACCRUAL',
  'REDEMPTION',
  'ADJUSTMENT',
  'REFUND',
] as const;

export type PointsTransactionType = (typeof POINTS_TRANSACTION_TYPES)[number];

/** user_points_ledger 1행 (camelCase 도메인 뷰). */
export type PointsLedgerEntry = {
  /** uuid — 전용 브랜드 없음(원장 행은 교차 참조되지 않음). */
  id: string;
  userId: UserId;
  orderId: OrderId | null;
  transactionType: PointsTransactionType;
  /** 양수 = 적립, 음수 = 차감. */
  pointsDelta: number;
  /** 트랜잭션 직후 잔액(>= 0, DB CHECK). */
  balanceAfter: number;
  description: string | null;
  createdAt: IsoTimestamp;
};

/**
 * 체크아웃/마이페이지 표시용 요약.
 * `available === false` 는 migration 031 미적용(feature-probe isPointsAvailable
 * false) 또는 비로그인 — 이때 balance 는 0 이고 UI 는 적립금 섹션을 숨긴다.
 */
export type PointsSummary = {
  balance: number;
  available: boolean;
};

// ---------- Policy constants ----------

/** 적립률(basis points). 100 bps = 1% — PAID 시 totalPrice 의 1% 적립. */
export const POINTS_EARN_RATE_BPS = 100;

/** redeem 후 남아야 하는 최소 결제액(KRW) — 0원 결제(전액 포인트) 방지. */
export const POINTS_MIN_PAYABLE = 100;

// ---------- Pure functions (UT target) ----------

/**
 * PAID 시 적립 포인트 = floor(totalPrice × 1%).
 * totalPrice 는 redeem 차감 후 실결제액(031 주석) — 포인트로 낸 금액엔 적립 없음.
 * 비정상 입력(음수/NaN/Infinity)은 0.
 */
export function calcEarnPoints(totalPrice: number): number {
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return 0;
  return Math.floor((totalPrice * POINTS_EARN_RATE_BPS) / 10_000);
}

/**
 * 사용 가능한 최대 포인트 = min(잔액, 결제예정액 − 최소결제액), 하한 0.
 * `payable` = 포인트 차감 전 결제 예정액(상품 + 배송비 + 도서산간 추가비).
 */
export function maxRedeemable(balance: number, payable: number): number {
  if (!Number.isFinite(balance) || !Number.isFinite(payable)) return 0;
  return Math.max(0, Math.min(Math.floor(balance), Math.floor(payable) - POINTS_MIN_PAYABLE));
}

// ---------- Zod schemas ----------

export const pointsTransactionTypeSchema = z.enum(POINTS_TRANSACTION_TYPES);

export const pointsSummarySchema = z.object({
  balance: z.number().int().nonnegative(),
  available: z.boolean(),
});

export const pointsLedgerEntrySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  orderId: z.string().min(1).nullable(),
  transactionType: pointsTransactionTypeSchema,
  pointsDelta: z.number().int(),
  balanceAfter: z.number().int().nonnegative(),
  description: z.string().nullable(),
  createdAt: z.string().min(1),
});
