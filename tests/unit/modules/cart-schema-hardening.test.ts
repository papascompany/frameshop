/**
 * cartItemSchema DB-타입 정합 강화 (FS-P1 security P1-001).
 *
 * probe true(034/035 적용) 시 projectId → cart_projects.project_local_id(uuid),
 * projectSeq → cart_items.project_seq(int4), productId → cart_projects.product_id
 * (uuid FK) 에 그대로 닿는다 — 스키마가 DB 컬럼보다 느슨하면 변조 입력이
 * Postgres 22P02/22003 무처리 500 을 유발한다. API 경계에서 거부됨을 고정한다.
 */

import { describe, expect, it } from 'vitest';
import { cartItemSchema } from '@/types/cart';

const VALID = {
  localId: '11111111-1111-4111-8111-111111111111',
  userId: null,
  productId: '33333333-3333-4333-8333-333333333333',
  variantId: 'v-1',
  photoId: 'ph-1',
  options: {
    sizeCode: '4x6',
    colorCode: 'black',
    matteCode: 'none',
    paperCode: 'glossy',
  },
  photoUrl: 'https://example.com/photo.jpg',
  cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
  previewUrl: 'https://example.com/preview.png',
  price: 30000,
  quantity: 1,
  createdAt: '2026-07-06T00:00:00.000Z',
};

describe('cartItemSchema — uuid/상한 강화 (P1-001)', () => {
  it('projectId: 비uuid 를 거부하고 uuid 는 통과한다 (22P02 방지)', () => {
    expect(
      cartItemSchema.safeParse({ ...VALID, projectId: 'x' }).success,
    ).toBe(false);
    expect(
      cartItemSchema.safeParse({ ...VALID, projectId: 'proj-1' }).success,
    ).toBe(false);
    expect(
      cartItemSchema.safeParse({
        ...VALID,
        projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }).success,
    ).toBe(true);
  });

  it('projectSeq: 9999 상한 — 초과·int4 범위 밖·음수를 거부한다 (22003 방지)', () => {
    const withSeq = (projectSeq: number) =>
      cartItemSchema.safeParse({
        ...VALID,
        projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        projectSeq,
      }).success;

    expect(withSeq(0)).toBe(true);
    expect(withSeq(9999)).toBe(true);
    expect(withSeq(10000)).toBe(false);
    expect(withSeq(2_147_483_648)).toBe(false); // int4 초과 — 감사 재현값
    expect(withSeq(-1)).toBe(false);
  });

  it('productId: 비uuid 를 거부한다 (cart_projects.product_id uuid FK — 23503/22P02 방지)', () => {
    expect(
      cartItemSchema.safeParse({ ...VALID, productId: 'p-1' }).success,
    ).toBe(false);
    expect(cartItemSchema.safeParse(VALID).success).toBe(true);
  });

  it('묶음 필드 부재·null(v1/레거시 항목)은 여전히 통과한다 — 옵셔널 무파손', () => {
    expect(cartItemSchema.safeParse(VALID).success).toBe(true);
    expect(
      cartItemSchema.safeParse({
        ...VALID,
        projectId: null,
        projectSeq: null,
        orientation: null,
      }).success,
    ).toBe(true);
  });
});
