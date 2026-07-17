/**
 * groupOrderByGroupId — 주문 묶음 그룹핑 뷰모델 (FS-X-00, ADR-026).
 *
 * 계약: 키 = OrderItem.snapshot.groupLabel(035 무관 durable — ADR-025 스냅샷
 * 동결), groupCartByProject 와 동형 — groups 첫 등장 순서 + lines/singles 입력
 * 순서 보존, 키 없음/깨진 키 = singles 폴백, subtotal = sum(price × quantity)
 * (OrderItem.price 는 단가 스냅샷).
 */

import { describe, expect, it } from 'vitest';
import { groupOrderByGroupId } from '@/lib/order/grouping';
import { asBrand } from '@/types/common';
import type {
  OrderId,
  OrderItemId,
  ProductId,
  ProductVariantId,
} from '@/types/common';
import type { OrderItem, OrderItemSnapshot } from '@/types/order';

let seq = 0;

function makeOrderItem(
  overrides: Partial<Omit<OrderItem, 'snapshot'>> & {
    snapshot?: Partial<OrderItemSnapshot>;
  } = {},
): OrderItem {
  seq += 1;
  const { snapshot: snapshotOverrides, ...itemOverrides } = overrides;
  return {
    id: asBrand<OrderItemId>(`oi-${seq}`),
    orderId: asBrand<OrderId>('order-1'),
    snapshot: {
      productId: asBrand<ProductId>('22222222-2222-4222-8222-222222222222'),
      variantId: asBrand<ProductVariantId>('v-1'),
      productName: '테스트 액자',
      options: {
        sizeCode: '4x6',
        colorCode: 'black',
        matteCode: 'none',
        paperCode: 'glossy',
      },
      sizeLabel: '4x6',
      colorLabel: '블랙',
      unitPrice: 5000,
      ...snapshotOverrides,
    },
    photoUrl: 'https://example.com/photo.jpg',
    cropTransform: { x: 100, y: 100, scale: 1, rotation: 0 },
    printFileUrl: null,
    quantity: 1,
    price: 5000,
    ...itemOverrides,
  };
}

describe('groupOrderByGroupId', () => {
  it('splits mixed items into label groups and singles with per-group subtotal', () => {
    const single1 = makeOrderItem();
    const a1 = makeOrderItem({
      price: 10_000,
      quantity: 2,
      snapshot: { groupLabel: '세트 1', projectSeq: 0 },
    });
    const a2 = makeOrderItem({
      price: 3_000,
      quantity: 1,
      snapshot: { groupLabel: '세트 1', projectSeq: 1 },
    });
    const b1 = makeOrderItem({
      price: 7_000,
      quantity: 3,
      snapshot: { groupLabel: '세트 2', projectSeq: 0 },
    });

    const result = groupOrderByGroupId([single1, a1, a2, b1]);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toEqual({
      key: '세트 1',
      lines: [a1, a2],
      subtotal: 10_000 * 2 + 3_000,
    });
    expect(result.groups[1]).toEqual({ key: '세트 2', lines: [b1], subtotal: 21_000 });
    expect(result.singles).toEqual([single1]);
  });

  it('preserves first-appearance order for groups and input order for lines', () => {
    const b1 = makeOrderItem({ snapshot: { groupLabel: '세트 B', projectSeq: 1 } });
    const a1 = makeOrderItem({ snapshot: { groupLabel: '세트 A', projectSeq: 0 } });
    const b0 = makeOrderItem({ snapshot: { groupLabel: '세트 B', projectSeq: 0 } });

    const result = groupOrderByGroupId([b1, a1, b0]);

    expect(result.groups.map((g) => g.key)).toEqual(['세트 B', '세트 A']);
    expect(result.groups[0]?.lines).toEqual([b1, b0]);
  });

  it('treats items without groupLabel as singles (legacy/flat orders)', () => {
    const legacy1 = makeOrderItem();
    const legacy2 = makeOrderItem();

    const result = groupOrderByGroupId([legacy1, legacy2]);

    expect(result.groups).toEqual([]);
    expect(result.singles).toEqual([legacy1, legacy2]);
  });

  it('falls back broken labels (empty/whitespace) to singles', () => {
    const emptyLabel = makeOrderItem({ snapshot: { groupLabel: '' } });
    const blankLabel = makeOrderItem({ snapshot: { groupLabel: '  ' } });
    const valid = makeOrderItem({ snapshot: { groupLabel: '세트 1' } });

    const result = groupOrderByGroupId([emptyLabel, blankLabel, valid]);

    expect(result.singles).toEqual([emptyLabel, blankLabel]);
    expect(result.groups).toEqual([{ key: '세트 1', lines: [valid], subtotal: 5_000 }]);
  });

  it('returns empty groups and singles for an empty item list', () => {
    expect(groupOrderByGroupId([])).toEqual({ groups: [], singles: [] });
  });
});
