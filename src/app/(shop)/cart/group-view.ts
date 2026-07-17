/**
 * 묶음(세트) 그룹 카드 표시용 순수 헬퍼 (FS-X-04, ADR-021/026).
 *
 * 그룹핑 뷰모델(groupCartByProject / groupOrderByGroupId)은 X-00 산출의
 * `@/lib/cart/grouping`·`@/lib/order/grouping` 이 SSOT 이고, 이 파일은 그 결과를
 * **화면 문자열**로 요약하는 표시 계층만 담는다 — cart / checkout / order
 * lookup 세 화면이 같은 구성 칩 문구를 공유해 표기 불일치를 막는다.
 *
 * 클라/서버 공용 — server-only import 금지, IO 없음.
 */

import type { Orientation } from '@/types/project';

/** 방향 한국어 라벨 (studio/wall 의 '가로형/세로형' 축약형 — 칩 표기용). */
export const ORIENTATION_LABELS: Record<Orientation, string> = {
  landscape: '가로',
  portrait: '세로',
};

/**
 * 그룹 구성 칩 문구 — 예: "가로 2 · 세로 1".
 * 방향 정보가 없는 라인(단품 승격/레거시)은 "기타 N" 으로 집계하고,
 * 전 라인이 방향 미상이면 "상품 N개" 폴백.
 */
export function composeOrientationChips(
  orientations: readonly (Orientation | null | undefined)[],
): string {
  let landscape = 0;
  let portrait = 0;
  let unknown = 0;
  for (const o of orientations) {
    if (o === 'landscape') landscape += 1;
    else if (o === 'portrait') portrait += 1;
    else unknown += 1;
  }
  const parts: string[] = [];
  if (landscape > 0) parts.push(`가로 ${landscape}`);
  if (portrait > 0) parts.push(`세로 ${portrait}`);
  if (unknown > 0 && parts.length > 0) parts.push(`기타 ${unknown}`);
  if (parts.length === 0) return `상품 ${orientations.length}개`;
  return parts.join(' · ');
}

/**
 * 카트 그룹 표시 제목 — 서버 groupLabel('묶음 1', …)과 같은 어휘로 번호를
 * 붙인다(카트의 그룹 키는 uuid 라 그대로 노출 불가).
 */
export function cartGroupTitle(index: number): string {
  return `묶음 ${index + 1}`;
}
