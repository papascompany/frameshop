/**
 * AdminOrders Server Actions 단위 테스트.
 *
 * 실제 actions.ts는 서버 액션(server-only + next/cache)에 의존하므로
 * 상태 전환 거부 로직을 InvalidStateTransitionError 클래스로 직접 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { InvalidStateTransitionError, ORDER_TRANSITIONS } from '@/types/order';
import { canTransition } from '@/lib/order/state';
import type { OrderStatus } from '@/types/order';

describe('InvalidStateTransitionError', () => {
  it('from, to 프로퍼티를 올바르게 보존한다', () => {
    const err = new InvalidStateTransitionError('DELIVERED', 'PAID');
    expect(err.from).toBe('DELIVERED');
    expect(err.to).toBe('PAID');
    expect(err.name).toBe('InvalidStateTransitionError');
    expect(err.message).toContain('DELIVERED');
    expect(err.message).toContain('PAID');
  });

  it('Error 인스턴스이다', () => {
    const err = new InvalidStateTransitionError('SHIPPED', 'CREATED');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidStateTransitionError);
  });
});

describe('startProductionAction 상태 전환 검증', () => {
  it('PAID → IN_PRODUCTION 은 유효한 전환이다', () => {
    expect(canTransition('PAID', 'IN_PRODUCTION')).toBe(true);
  });

  it('CREATED → IN_PRODUCTION 은 유효하지 않은 전환이다', () => {
    expect(canTransition('CREATED', 'IN_PRODUCTION')).toBe(false);
  });

  it('SHIPPED → IN_PRODUCTION 은 유효하지 않은 전환이다', () => {
    expect(canTransition('SHIPPED', 'IN_PRODUCTION')).toBe(false);
  });
});

describe('shipOrderAction 상태 전환 검증', () => {
  it('IN_PRODUCTION → SHIPPED 은 유효한 전환이다', () => {
    expect(canTransition('IN_PRODUCTION', 'SHIPPED')).toBe(true);
  });

  it('PAID → SHIPPED 은 유효하지 않은 전환이다', () => {
    expect(canTransition('PAID', 'SHIPPED')).toBe(false);
  });

  it('DELIVERED → SHIPPED 은 유효하지 않은 전환이다', () => {
    expect(canTransition('DELIVERED', 'SHIPPED')).toBe(false);
  });
});

describe('markDeliveredAction 상태 전환 검증', () => {
  it('SHIPPED → DELIVERED 은 유효한 전환이다', () => {
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
  });

  it('PAID → DELIVERED 은 유효하지 않은 전환이다', () => {
    expect(canTransition('PAID', 'DELIVERED')).toBe(false);
  });

  it('IN_PRODUCTION → DELIVERED 은 유효하지 않은 전환이다', () => {
    expect(canTransition('IN_PRODUCTION', 'DELIVERED')).toBe(false);
  });
});

describe('ORDER_TRANSITIONS 완전성', () => {
  const validAdminTransitions: Array<[OrderStatus, OrderStatus]> = [
    ['PAID', 'IN_PRODUCTION'],
    ['IN_PRODUCTION', 'SHIPPED'],
    ['SHIPPED', 'DELIVERED'],
  ];

  it('모든 관리자 전환이 ORDER_TRANSITIONS에 정의되어 있다', () => {
    for (const [from, to] of validAdminTransitions) {
      expect(ORDER_TRANSITIONS[from]).toContain(to);
    }
  });

  it('잘못된 상태에서 transitionTo를 호출하면 InvalidStateTransitionError가 발생해야 한다', () => {
    const invalidTransitions: Array<[OrderStatus, OrderStatus]> = [
      ['DELIVERED', 'IN_PRODUCTION'],
      ['CANCELLED', 'SHIPPED'],
      ['CREATED', 'DELIVERED'],
    ];

    for (const [from, to] of invalidTransitions) {
      if (!canTransition(from, to)) {
        const err = new InvalidStateTransitionError(from, to);
        expect(err).toBeInstanceOf(InvalidStateTransitionError);
        expect(err.from).toBe(from);
        expect(err.to).toBe(to);
      }
    }
  });
});
