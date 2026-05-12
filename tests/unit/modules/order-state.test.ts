/**
 * Order state machine (UT-05, TDD 1st priority).
 *
 * Spec: docs/specs/order.md AC-3~6.
 */

import { describe, expect, it } from 'vitest';
import { canTransition, formatOrderNo, parseOrderNo, nextStatuses } from '@/lib/order/state';
import { ORDER_STATUSES, ORDER_TRANSITIONS, type OrderStatus } from '@/types/order';

describe('canTransition', () => {
  it('allows every forward transition from the static table', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it('is idempotent — same-state transitions are valid', () => {
    for (const s of ORDER_STATUSES) {
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it('blocks invalid transitions', () => {
    const invalid: Array<[OrderStatus, OrderStatus]> = [
      ['DELIVERED', 'PAID'],
      ['SHIPPED', 'CREATED'],
      ['CREATED', 'SHIPPED'],
      ['IN_PRODUCTION', 'PAID'],
    ];
    for (const [from, to] of invalid) {
      expect(canTransition(from, to)).toBe(false);
    }
  });

  it('treats CANCELLED and REFUNDED as terminal', () => {
    for (const target of ORDER_STATUSES) {
      if (target === 'CANCELLED' || target === 'REFUNDED') continue;
      expect(canTransition('CANCELLED', target)).toBe(false);
      expect(canTransition('REFUNDED', target)).toBe(false);
    }
  });
});

describe('nextStatuses', () => {
  it('returns the static allow-list for each state', () => {
    expect(nextStatuses('CREATED')).toEqual(['PAID', 'CANCELLED']);
    expect(nextStatuses('DELIVERED')).toEqual(['REFUNDED']);
    expect(nextStatuses('CANCELLED')).toEqual([]);
  });
});

describe('formatOrderNo / parseOrderNo', () => {
  it('formats YYYYMMDD-NNNN in KST', () => {
    // 2026-05-12 06:00 UTC = 2026-05-12 15:00 KST
    const day = new Date(Date.UTC(2026, 4, 12, 6, 0, 0));
    expect(formatOrderNo(day, 1)).toBe('20260512-0001');
    expect(formatOrderNo(day, 42)).toBe('20260512-0042');
  });

  it('round-trips through parseOrderNo', () => {
    const orderNo = '20260512-0007';
    const parsed = parseOrderNo(orderNo);
    expect(parsed).toEqual({ date: '20260512', seq: 7 });
  });

  it('returns null for malformed order numbers', () => {
    expect(parseOrderNo('not-an-order')).toBeNull();
    expect(parseOrderNo('2026-05-12-0001')).toBeNull();
  });
});
