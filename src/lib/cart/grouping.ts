/**
 * 카트 묶음(프로젝트) 그룹핑 뷰모델 — 순수 함수 (FS-X-00, ADR-026).
 *
 * 그룹 키 SSOT: `CartItem.projectId` (ADR-025 — 클라 projectLocalId 또는 서버
 * cart_projects PK). null/undefined = 레거시 단품 → singles. 깨진 키(빈 문자열/
 * 공백)도 단품 폴백한다 — 그룹 UI(원자 선택·묶음 헤더)가 잘못된 키로 라인을
 * 묶어버리는 것보다 단품 표시가 안전하다.
 *
 * 순서 계약: groups 는 키의 **첫 등장 순서**, 각 그룹의 lines 와 singles 는
 * 입력 배열의 등장 순서를 그대로 보존한다(정렬하지 않음 — projectSeq 정렬이
 * 필요하면 호출부 재량).
 *
 * subtotal = sum(price × quantity) — getCartSummary 와 동일 의미(단가 스냅샷 ×
 * 수량). 비정상 라인(비유한 price/quantity)은 0 으로 집계해 NaN 전파를 막는다.
 *
 * 클라/서버 공용 — server-only import 금지.
 */

import type { CartItem } from '@/types/cart';

export type CartGroup = {
  /** 그룹 키 = CartItem.projectId (trim 원본 유지). */
  key: string;
  /** 입력 등장 순서 그대로의 그룹 라인들. */
  lines: CartItem[];
  /** sum(price × quantity). */
  subtotal: number;
};

export type GroupedCart = {
  groups: CartGroup[];
  singles: CartItem[];
};

function lineTotal(item: CartItem): number {
  const { price, quantity } = item;
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) return 0;
  return price * quantity;
}

export function groupCartByProject(items: readonly CartItem[]): GroupedCart {
  const groups: CartGroup[] = [];
  const byKey = new Map<string, CartGroup>();
  const singles: CartItem[] = [];

  for (const item of items) {
    const raw = item.projectId;
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (key === '') {
      singles.push(item);
      continue;
    }
    let group = byKey.get(key);
    if (!group) {
      group = { key, lines: [], subtotal: 0 };
      byKey.set(key, group);
      groups.push(group);
    }
    group.lines.push(item);
    group.subtotal += lineTotal(item);
  }

  return { groups, singles };
}
