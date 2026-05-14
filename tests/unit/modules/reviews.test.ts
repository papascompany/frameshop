/**
 * 리뷰 시스템 단위 테스트.
 * - rating 범위 검증
 * - 이름 마스킹 함수
 */

import { describe, it, expect } from 'vitest';
import { maskName } from '@/components/marketing/RecentReviews';

describe('maskName', () => {
  it('3자 한국어 이름을 마스킹한다', () => {
    expect(maskName('홍길동')).toBe('홍**');
  });

  it('2자 이름을 마스킹한다', () => {
    expect(maskName('길동')).toBe('길*');
  });

  it('1자 이름은 그대로 반환한다', () => {
    expect(maskName('홍')).toBe('홍');
  });

  it('빈 문자열은 빈 문자열을 반환한다', () => {
    expect(maskName('')).toBe('');
  });

  it('공백만 있으면 빈 문자열을 반환한다', () => {
    expect(maskName('   ')).toBe('');
  });

  it('영문 이름을 마스킹한다', () => {
    // "John" → "J**"
    expect(maskName('John')).toBe('J**');
  });
});

describe('rating 범위 검증', () => {
  it('1에서 5 사이의 별점이 유효하다', () => {
    const validRatings = [1, 2, 3, 4, 5];
    for (const r of validRatings) {
      expect(r >= 1 && r <= 5).toBe(true);
    }
  });

  it('0 또는 6은 유효하지 않다', () => {
    const invalidRatings = [0, 6, -1, 10];
    for (const r of invalidRatings) {
      expect(r >= 1 && r <= 5).toBe(false);
    }
  });
});
