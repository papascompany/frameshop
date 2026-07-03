/**
 * FS-EC-01 UT — 체크아웃 제출 검증(동의 미체크 차단).
 *
 * FROZEN 계약: submit 은 `checkoutFormSchema` + `checkoutAgreementsSchema` 를
 * **둘 다** 통과해야 한다. validateCheckoutSubmit 이 두 결과를 하나의 에러
 * 맵으로 병합하는지 검증한다.
 */

import { describe, expect, it } from 'vitest';
import { validateCheckoutSubmit } from '@/app/(shop)/checkout/submit-validation';
import type { CheckoutFormData } from '@/types/checkout';

function validBase(): CheckoutFormData {
  return {
    orderer: {
      name: '홍길동',
      phone: '010-1234-5678',
      email: 'hong@example.com',
    },
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

describe('validateCheckoutSubmit — 필수 동의', () => {
  it('동의 미체크 → 차단 + 두 항목 모두 인라인 에러', () => {
    const result = validateCheckoutSubmit(validBase());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['agreePrivacy']).toBe(
      '개인정보 수집·이용에 동의해주세요',
    );
    expect(result.errors['agreePurchase']).toBe(
      '구매조건 확인 및 결제 진행에 동의해주세요',
    );
  });

  it('개인정보만 동의 → 구매조건 에러만 남는다', () => {
    const result = validateCheckoutSubmit({
      ...validBase(),
      agreePrivacy: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['agreePrivacy']).toBeUndefined();
    expect(result.errors['agreePurchase']).toBeDefined();
  });

  it('둘 다 동의하면 통과', () => {
    const result = validateCheckoutSubmit({
      ...validBase(),
      agreePrivacy: true,
      agreePurchase: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it('base 에러(이메일)와 동의 에러가 병합된다', () => {
    const form = validBase();
    form.orderer.email = 'not-an-email';
    const result = validateCheckoutSubmit(form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['orderer.email']).toBeDefined();
    expect(result.errors['agreePrivacy']).toBeDefined();
    expect(result.errors['agreePurchase']).toBeDefined();
  });
});

describe('validateCheckoutSubmit — 현금영수증(base superRefine 경유)', () => {
  it('신청인데 유형/식별번호 누락 → 차단', () => {
    const result = validateCheckoutSubmit({
      ...validBase(),
      agreePrivacy: true,
      agreePurchase: true,
      receiptRequested: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors['receiptType']).toBe('현금영수증 유형을 선택해주세요');
    expect(result.errors['receiptInfo']).toBe(
      '숫자와 하이픈만 8~20자로 입력해주세요',
    );
  });

  it('신청 + 유효 입력 → 통과', () => {
    const result = validateCheckoutSubmit({
      ...validBase(),
      agreePrivacy: true,
      agreePurchase: true,
      receiptRequested: true,
      receiptType: 'income',
      receiptInfo: '010-1234-5678',
    });
    expect(result).toEqual({ ok: true });
  });

  it('미신청이면 영수증 필드는 검증하지 않는다', () => {
    const result = validateCheckoutSubmit({
      ...validBase(),
      agreePrivacy: true,
      agreePurchase: true,
      receiptRequested: false,
      receiptInfo: '',
    });
    expect(result).toEqual({ ok: true });
  });
});
