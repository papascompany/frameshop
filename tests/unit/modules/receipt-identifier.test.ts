/**
 * 현금영수증 식별번호 — 숫자 최소 8자리 규칙(FS-EC P2-3) + 서버 마스킹(P2-1).
 *
 * 기존 `^[0-9-]+$` + 길이 8~20 규칙은 "--------"(전부 하이픈)를 통과시켰다.
 * order.ts(cashReceiptRequestSchema, 서버 재검증 경로)와 checkout.ts
 * (superRefine, 폼 경로)가 동일하게 숫자 8자리 미만을 차단하는지 고정한다.
 */

import { describe, expect, it } from 'vitest';
import { cashReceiptRequestSchema, maskReceiptInfo } from '@/types/order';
import { checkoutFormSchema } from '@/types/checkout';
import type { CheckoutFormData } from '@/types/checkout';

function validForm(): CheckoutFormData {
  return {
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'hong@example.com' },
    shipping: {
      sameAsOrderer: false,
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '06236',
      addr1: '서울 강남구 테헤란로 1',
      addr2: '101호',
      memo: '',
    },
    shippingMethod: 'STANDARD',
  };
}

describe('cashReceiptRequestSchema — 숫자 최소 8자리 (서버 재검증 경로)', () => {
  it('전부 하이픈("--------")은 길이/문자 규칙을 통과해도 거부한다', () => {
    expect(
      cashReceiptRequestSchema.safeParse({ type: 'income', info: '--------' })
        .success,
    ).toBe(false);
    // 하이픈 섞인 숫자 8자리 미만도 거부.
    expect(
      cashReceiptRequestSchema.safeParse({ type: 'proof', info: '123-45-6' })
        .success,
    ).toBe(false);
  });

  it('유효한 휴대폰/사업자번호는 기존대로 통과한다(옵셔널 추가 원칙)', () => {
    expect(
      cashReceiptRequestSchema.safeParse({ type: 'income', info: '010-1234-5678' })
        .success,
    ).toBe(true);
    expect(
      cashReceiptRequestSchema.safeParse({ type: 'proof', info: '123-45-67890' })
        .success,
    ).toBe(true);
  });
});

describe('checkoutFormSchema superRefine — 동일 규칙 (폼 경로)', () => {
  it('receiptRequested + 전부 하이픈 → receiptInfo 이슈로 차단', () => {
    const result = checkoutFormSchema.safeParse({
      ...validForm(),
      receiptRequested: true,
      receiptType: 'income',
      receiptInfo: '--------',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path.join('.') === 'receiptInfo',
    );
    expect(issue?.message).toBe('숫자를 8자리 이상 입력해주세요');
  });

  it('유효 식별번호는 통과하고, 미신청이면 규칙 자체가 적용되지 않는다', () => {
    expect(
      checkoutFormSchema.safeParse({
        ...validForm(),
        receiptRequested: true,
        receiptType: 'income',
        receiptInfo: '010-1234-5678',
      }).success,
    ).toBe(true);
    expect(
      checkoutFormSchema.safeParse({
        ...validForm(),
        receiptRequested: false,
        receiptInfo: '--------',
      }).success,
    ).toBe(true);
  });
});

describe('maskReceiptInfo — 서버 마스킹 (P2-1)', () => {
  it('마지막 4자리 숫자만 남기고 하이픈은 유지한다', () => {
    expect(maskReceiptInfo('010-1234-5678')).toBe('***-****-5678');
    expect(maskReceiptInfo('123-45-67890')).toBe('***-**-*7890');
    expect(maskReceiptInfo(null)).toBeNull();
    expect(maskReceiptInfo(undefined)).toBeNull();
  });

  it('이미 마스킹된 값에 멱등이다(클라이언트 렌더 시점 재마스킹 안전)', () => {
    const once = maskReceiptInfo('010-1234-5678');
    expect(maskReceiptInfo(once)).toBe(once);
  });
});
