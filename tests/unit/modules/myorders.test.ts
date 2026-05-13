/**
 * My Orders — 주문 상태 한국어 매핑 함수 테스트.
 */

import { describe, expect, it } from 'vitest';
import { orderStatusLabel } from '@/app/(shop)/account/orders/MyOrdersClient';
import type { OrderStatus } from '@/types/order';

describe('orderStatusLabel', () => {
  const cases: Array<[OrderStatus, string]> = [
    ['CREATED', '주문접수'],
    ['PAID', '결제완료'],
    ['IN_PRODUCTION', '제작중'],
    ['SHIPPED', '배송중'],
    ['DELIVERED', '배송완료'],
    ['CANCELLED', '취소됨'],
    ['REFUNDED', '환불됨'],
  ];

  it.each(cases)('status %s → "%s"', (status, expected) => {
    expect(orderStatusLabel(status)).toBe(expected);
  });

  it('모든 OrderStatus 값에 대해 한국어 문자열을 반환한다', () => {
    const allStatuses: OrderStatus[] = [
      'CREATED',
      'PAID',
      'IN_PRODUCTION',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
    ];
    for (const s of allStatuses) {
      const label = orderStatusLabel(s);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
