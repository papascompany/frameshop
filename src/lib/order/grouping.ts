/**
 * 주문 묶음 그룹핑 뷰모델 — 순수 함수 (FS-X-00, ADR-026).
 *
 * 그룹 키 SSOT: `OrderItem.snapshot.groupLabel` (ADR-025 — createOrder 가
 * variant_snapshot jsonb 에 동결하는 묶음 표시 라벨). 마이그레이션 035 적용
 * 여부와 무관하게 durable 하고, mapOrderItem 이 전용 컬럼(project_group_id)을
 * 노출하지 않으므로 groupLabel 이 유일한 그룹 키다.
 *
 * 계약은 groupCartByProject 와 동형: 키 없음(undefined)/깨진 키(빈 문자열·공백)
 * = singles 폴백, groups 는 첫 등장 순서, lines/singles 는 입력 등장 순서 보존.
 * subtotal = sum(price × quantity) — OrderItem.price 는 단가 스냅샷(unitPrice
 * 검증 후 v.price 저장)이므로 수량을 곱한다.
 *
 * 클라/서버 공용 — server-only import 금지 (lookup 클라 렌더에서도 사용).
 */

import type { OrderItem } from '@/types/order';

/**
 * 그룹핑이 실제로 사용하는 최소 라인 형태 (FS-X-04 제네릭 확장). guest lookup
 * 라우트처럼 OrderItem 전체가 아닌 축소 프로젝션도 같은 뷰모델로 그룹핑할 수
 * 있다 — 기본 타입 파라미터가 OrderItem 이라 기존 소비자는 무변경 컴파일.
 */
export type OrderGroupableLine = {
  price: number;
  quantity: number;
  snapshot: { groupLabel?: string };
};

export type OrderGroup<T extends OrderGroupableLine = OrderItem> = {
  /** 그룹 키 = snapshot.groupLabel (trim 원본 유지). */
  key: string;
  /** 입력 등장 순서 그대로의 그룹 라인들. */
  lines: T[];
  /** sum(price × quantity). */
  subtotal: number;
};

export type GroupedOrder<T extends OrderGroupableLine = OrderItem> = {
  groups: OrderGroup<T>[];
  singles: T[];
};

function lineTotal(item: OrderGroupableLine): number {
  const { price, quantity } = item;
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) return 0;
  return price * quantity;
}

export function groupOrderByGroupId<T extends OrderGroupableLine>(
  items: readonly T[],
): GroupedOrder<T> {
  const groups: OrderGroup<T>[] = [];
  const byKey = new Map<string, OrderGroup<T>>();
  const singles: T[] = [];

  for (const item of items) {
    const raw = item.snapshot.groupLabel;
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
