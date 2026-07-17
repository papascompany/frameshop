/**
 * groupCartByProject — 카트 묶음 그룹핑 뷰모델 (FS-X-00, ADR-026).
 *
 * 계약: 키 = CartItem.projectId, groups 첫 등장 순서 + lines/singles 입력 순서
 * 보존, null/undefined/깨진 키(빈 문자열·공백) = singles 폴백,
 * subtotal = sum(price × quantity).
 */

import { describe, expect, it } from 'vitest';
import { groupCartByProject } from '@/lib/cart/grouping';
import { asBrand } from '@/types/common';
import type {
  CartItemId,
  CartProjectId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  UserId,
} from '@/types/common';
import type { CartItem } from '@/types/cart';

let seq = 0;

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  seq += 1;
  return {
    id: asBrand<CartItemId>(`ci-${seq}`),
    localId: asBrand<LocalId>('a1b2c3d4-5e6f-4a89-9bca-1234567890ab'),
    userId: asBrand<UserId>('u-1'),
    productId: asBrand<ProductId>('22222222-2222-4222-8222-222222222222'),
    variantId: asBrand<ProductVariantId>('v-1'),
    photoId: asBrand<PhotoId>('ph-1'),
    options: {
      sizeCode: '4x6',
      colorCode: 'black',
      matteCode: 'none',
      paperCode: 'glossy',
    },
    photoUrl: 'https://example.com/photo.jpg',
    cropTransform: { x: 100, y: 100, scale: 1, rotation: 0 },
    previewUrl: 'https://example.com/preview.png',
    price: 5000,
    quantity: 1,
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

const PROJECT_A = asBrand<CartProjectId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const PROJECT_B = asBrand<CartProjectId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

describe('groupCartByProject', () => {
  it('splits mixed carts into project groups and singles with per-group subtotal', () => {
    const single1 = makeItem();
    const a1 = makeItem({ projectId: PROJECT_A, projectSeq: 0, price: 10_000, quantity: 2 });
    const single2 = makeItem();
    const a2 = makeItem({ projectId: PROJECT_A, projectSeq: 1, price: 3_000, quantity: 1 });
    const b1 = makeItem({ projectId: PROJECT_B, projectSeq: 0, price: 7_000, quantity: 3 });

    const result = groupCartByProject([single1, a1, single2, a2, b1]);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toEqual({
      key: PROJECT_A,
      lines: [a1, a2],
      subtotal: 10_000 * 2 + 3_000,
    });
    expect(result.groups[1]).toEqual({ key: PROJECT_B, lines: [b1], subtotal: 21_000 });
    expect(result.singles).toEqual([single1, single2]);
  });

  it('preserves first-appearance order for groups and input order for lines', () => {
    // B 가 먼저 등장 → groups[0] = B. 그룹 내 라인은 projectSeq 가 역순이어도
    // 입력 순서를 그대로 보존한다(정렬은 호출부 재량 — 계약 문서화).
    const b1 = makeItem({ projectId: PROJECT_B, projectSeq: 1 });
    const a1 = makeItem({ projectId: PROJECT_A, projectSeq: 0 });
    const b0 = makeItem({ projectId: PROJECT_B, projectSeq: 0 });

    const result = groupCartByProject([b1, a1, b0]);

    expect(result.groups.map((g) => g.key)).toEqual([PROJECT_B, PROJECT_A]);
    expect(result.groups[0]?.lines).toEqual([b1, b0]);
  });

  it('treats null/undefined projectId as singles (legacy flat items)', () => {
    const explicitNull = makeItem({ projectId: null });
    const absent = makeItem(); // projectId 필드 자체가 없음(v1 카트)

    const result = groupCartByProject([explicitNull, absent]);

    expect(result.groups).toEqual([]);
    expect(result.singles).toEqual([explicitNull, absent]);
  });

  it('falls back broken keys (empty/whitespace) to singles', () => {
    const emptyKey = makeItem({ projectId: asBrand<CartProjectId>('') });
    const blankKey = makeItem({ projectId: asBrand<CartProjectId>('   ') });
    const valid = makeItem({ projectId: PROJECT_A });

    const result = groupCartByProject([emptyKey, blankKey, valid]);

    expect(result.singles).toEqual([emptyKey, blankKey]);
    expect(result.groups).toEqual([{ key: PROJECT_A, lines: [valid], subtotal: 5_000 }]);
  });

  it('returns empty groups and singles for an empty cart', () => {
    expect(groupCartByProject([])).toEqual({ groups: [], singles: [] });
  });
});
