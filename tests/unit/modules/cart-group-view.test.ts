/**
 * 묶음 그룹 카드 표시 헬퍼 (FS-X-04) — composeOrientationChips / cartGroupTitle.
 *
 * 고정하는 계약: 구성 칩 문구("가로 2 · 세로 1"), 방향 미상 라인의 "기타 N"
 * 집계, 전 라인 미상 시 "상품 N개" 폴백, 카트 그룹 제목이 서버 groupLabel
 * 어휘('묶음 N')와 일치.
 */

import { describe, expect, it } from 'vitest';
import {
  ORIENTATION_LABELS,
  cartGroupTitle,
  composeOrientationChips,
} from '@/app/(shop)/cart/group-view';

describe('composeOrientationChips', () => {
  it('가로/세로 혼합 구성을 "가로 N · 세로 M" 으로 요약한다', () => {
    expect(
      composeOrientationChips(['landscape', 'portrait', 'landscape']),
    ).toBe('가로 2 · 세로 1');
  });

  it('한 방향만 있으면 그 칩만 표시한다', () => {
    expect(composeOrientationChips(['portrait', 'portrait'])).toBe('세로 2');
  });

  it('방향 미상(null/undefined) 라인은 "기타 N" 으로 집계한다', () => {
    expect(composeOrientationChips(['landscape', null, undefined])).toBe(
      '가로 1 · 기타 2',
    );
  });

  it('전 라인 방향 미상이면 "상품 N개" 폴백', () => {
    expect(composeOrientationChips([null, undefined, null])).toBe('상품 3개');
  });
});

describe('cartGroupTitle / ORIENTATION_LABELS', () => {
  it('서버 groupLabel 어휘("묶음 N")와 같은 제목을 만든다 (1-base)', () => {
    expect(cartGroupTitle(0)).toBe('묶음 1');
    expect(cartGroupTitle(2)).toBe('묶음 3');
  });

  it('방향 라벨은 가로/세로 축약형', () => {
    expect(ORIENTATION_LABELS.landscape).toBe('가로');
    expect(ORIENTATION_LABELS.portrait).toBe('세로');
  });
});
