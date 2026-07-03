/**
 * mapOrder / mapShippingMethod graceful fallback (FS-EC-00).
 *
 * 030/031/038/039 는 CTO 수동 적용이라 미적용일 수 있다. 신규 컬럼 부재 시
 * mapOrder 가 refunded/points/surcharge 를 0, receipt_* 를 null 로 폴백하고,
 * mapShippingMethod 가 surcharge 요금을 0 으로 폴백해야 앱이 게이트 없이 돈다
 * (ADR-023 product_type 폴백과 동일 원칙).
 */

import { describe, expect, it } from 'vitest';
import { mapOrder, mapShippingMethod } from '@/lib/db/mappers';
import type { Orderer, ShippingAddress } from '@/types/order';

const orderer: Orderer = {
  name: '홍길동',
  phone: '010-1234-5678',
  email: 'a@b.com',
};

const shipping: ShippingAddress = {
  name: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  addr1: '서울특별시 강남구 테헤란로 1',
  addr2: '101동 1234호',
  memo: '',
};

const baseOrderRow = {
  id: 'o-1',
  order_no: 'FS-20260703-0001',
  user_id: null,
  status: 'PAID',
  total_price: 45_000,
  shipping_fee: 3_000,
  shipping_method: 'STANDARD',
  payment_id: null,
  tracking_number: null,
  courier: null,
  orderer,
  shipping,
  created_at: '2026-07-03T00:00:00.000Z',
  paid_at: '2026-07-03T00:10:00.000Z',
  shipped_at: null,
};

const baseShippingRow = {
  id: 'sm-1',
  code: 'STANDARD',
  label: '택배 배송',
  fee: 3_000,
  free_threshold: 30_000,
  note: null,
  is_active: true,
  sort_order: 0,
  created_at: '2026-05-12T00:00:00Z',
  updated_at: '2026-05-12T00:00:00Z',
};

describe('mapOrder FS-EC-00 fallbacks', () => {
  it('falls back to 0/null when 030/031/038/039 columns are absent', () => {
    const order = mapOrder({ ...baseOrderRow });
    expect(order.surchargeFee).toBe(0);
    expect(order.pointsRedeemed).toBe(0);
    expect(order.pointsAccrued).toBe(0);
    expect(order.refundedAmount).toBe(0);
    expect(order.receiptType).toBeNull();
    expect(order.receiptInfo).toBeNull();
    expect(order.receiptUrl).toBeNull();
    expect(order.receiptIssuedAt).toBeNull();
  });

  it('passes values through when the migrations are applied', () => {
    const order = mapOrder({
      ...baseOrderRow,
      surcharge_fee: 3_000,
      points_redeemed: 500,
      points_accrued: 445,
      refunded_amount: 10_000,
      receipt_type: 'income',
      receipt_info: '010-1234-5678',
      receipt_url: 'https://dashboard.tosspayments.com/receipt/r-1',
      receipt_issued_at: '2026-07-03T00:11:00.000Z',
    });
    expect(order.surchargeFee).toBe(3_000);
    expect(order.pointsRedeemed).toBe(500);
    expect(order.pointsAccrued).toBe(445);
    expect(order.refundedAmount).toBe(10_000);
    expect(order.receiptType).toBe('income');
    expect(order.receiptInfo).toBe('010-1234-5678');
    expect(order.receiptUrl).toBe('https://dashboard.tosspayments.com/receipt/r-1');
    expect(order.receiptIssuedAt).toBe('2026-07-03T00:11:00.000Z');
  });

  it('maps an unexpected receipt_type to null (defensive)', () => {
    expect(mapOrder({ ...baseOrderRow, receipt_type: 'bogus' }).receiptType).toBeNull();
  });

  it('keeps existing 029/033 fallbacks intact (회귀 가드)', () => {
    const order = mapOrder({ ...baseOrderRow });
    expect(order.orderMemo).toBeNull();
    expect(order.confirmedAt).toBeNull();
  });
});

describe('mapShippingMethod FS-EC-00 fallbacks', () => {
  it('falls back surcharge fees to 0 when 030 columns are absent', () => {
    const cfg = mapShippingMethod({ ...baseShippingRow });
    expect(cfg.surchargeFeeJeju).toBe(0);
    expect(cfg.surchargeFeeRemote).toBe(0);
  });

  it('passes surcharge fees through when 030 is applied', () => {
    const cfg = mapShippingMethod({
      ...baseShippingRow,
      surcharge_fee_jeju: 3_000,
      surcharge_fee_remote: 5_000,
    });
    expect(cfg.surchargeFeeJeju).toBe(3_000);
    expect(cfg.surchargeFeeRemote).toBe(5_000);
  });
});
