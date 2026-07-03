/**
 * COMPANY 사업자 정보 SSOT — 형식 검증 (FS-EC-05).
 *
 * Footer · /terms · /privacy 가 공유하는 상수의 형식이 깨지면 법적 고지가
 * 잘못 노출되므로 최소한의 형식 불변식을 고정한다.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPANY,
  PRIVACY_PROCESSORS,
  LEGAL_DRAFT_NOTICE,
} from '@/lib/legal/company';

describe('COMPANY constants', () => {
  it('사업자등록번호가 000-00-00000 형식이다', () => {
    expect(COMPANY.businessRegistrationNo).toMatch(/^\d{3}-\d{2}-\d{5}$/);
  });

  it('대표전화 tel: href가 표기용 번호와 일치한다', () => {
    expect(COMPANY.phoneHref).toBe(
      `tel:${COMPANY.phone.replace(/-/g, '')}`,
    );
  });

  it('법적 고지 필수 필드가 비어있지 않다', () => {
    const required = [
      COMPANY.name,
      COMPANY.ceo,
      COMPANY.mailOrderSalesNo,
      COMPANY.addressHq,
      COMPANY.privacyOfficer,
    ];
    for (const value of required) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('PRIVACY_PROCESSORS', () => {
  it('결제대행(토스페이먼츠)과 배송 위탁 항목을 포함한다', () => {
    const names = PRIVACY_PROCESSORS.map((p) => p.name).join(' ');
    expect(names).toContain('토스페이먼츠');
    expect(names).toContain('배송');
  });

  it('모든 수탁사 항목에 위탁 업무가 기재되어 있다', () => {
    for (const p of PRIVACY_PROCESSORS) {
      expect(p.task.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('LEGAL_DRAFT_NOTICE', () => {
  it('법률 자문 전 초안임을 명시한다', () => {
    expect(LEGAL_DRAFT_NOTICE).toContain('법률 자문 전 초안');
  });
});
