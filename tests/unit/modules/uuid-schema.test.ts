/**
 * 식별자 UUID 검증 회귀 테스트 (2026-08-08 실사고).
 *
 * Zod v4 의 `uuid` 는 RFC 4122 의 버전·variant 비트까지 강제해서
 * `00000000-0000-0000-0000-000000000010` 같은 **시드 식별자를 거부**한다.
 * 그 결과 `/api/cart`·`/api/orders` 가 전부 422 BAD_INPUT 을 냈고
 * (로그인 장바구니 무음 비움 + 주문 생성 불가), 결제 키와 무관한
 * 런칭 차단 요인이었다.
 *
 * 계약: 식별자는 `uuidLike`(= `z.guid()`) 로만 검증한다 — 형식은 지키되
 * 버전 비트는 요구하지 않는다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { uuidLike } from '@/types/common';
import { cartItemSchema } from '@/types/cart';

const SEED_ID = '00000000-0000-0000-0000-000000000010';
const REAL_V4 = '455e3c24-0839-46d9-8dd7-f785c3440844';

describe('uuidLike — 식별자 형식 검증', () => {
  it('시드 식별자(버전 비트 0)를 통과시킨다', () => {
    expect(uuidLike.safeParse(SEED_ID).success).toBe(true);
  });

  it('실제 v4 UUID 도 통과시킨다', () => {
    expect(uuidLike.safeParse(REAL_V4).success).toBe(true);
  });

  it('형식이 아닌 값·주입 문자열은 계속 거부한다 (22P02 방어 유지)', () => {
    for (const bad of [
      'not-a-uuid',
      "1'; DROP TABLE cart_items;--",
      '',
      '00000000-0000-0000-0000-00000000001',
      '00000000-0000-0000-0000-0000000000100',
    ]) {
      expect(uuidLike.safeParse(bad).success).toBe(false);
    }
  });

  it('엄격한 z.uuid() 였다면 시드가 거부됐음을 고정 (회귀 근거)', () => {
    expect(z.uuid().safeParse(SEED_ID).success).toBe(false);
  });
});

describe('cartItemSchema — 시드 상품 장바구니 담기', () => {
  const item = {
    userId: null,
    productId: SEED_ID,
    variantId: '00000000-0000-0000-0000-000000000103',
    photoId: REAL_V4,
    options: {
      sizeCode: '8x10',
      colorCode: 'black',
      matteCode: 'none',
      paperCode: 'glossy',
    },
    photoUrl: 'https://example.supabase.co/storage/v1/object/sign/photos/a/b.jpg',
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    previewUrl: 'https://example.supabase.co/storage/v1/object/sign/previews/a/b.jpg',
    price: 14800,
    quantity: 1,
    localId: 'f0b4a1e2-1111-4222-8333-444455556666',
    createdAt: '2026-08-08T00:00:00.000Z',
  };

  it('시드 productId/variantId 를 가진 항목이 통과한다', () => {
    const parsed = cartItemSchema.safeParse(item);
    expect(parsed.success).toBe(true);
  });

  it('형식이 깨진 productId 는 여전히 거부한다', () => {
    const parsed = cartItemSchema.safeParse({ ...item, productId: 'abc' });
    expect(parsed.success).toBe(false);
  });
});

describe('소스 계약 — 엄격 uuid 재도입 금지', () => {
  it('src 전체에 z.uuid()/z.string().uuid() 호출이 없다', () => {
    const files = [
      'src/types/cart.ts',
      'src/types/set.ts',
      'src/types/inquiry.ts',
      'src/types/wishlist.ts',
      'src/app/api/reviews/route.ts',
      'src/app/api/account/wishlist/route.ts',
      'src/app/api/render/print/route.ts',
      'src/app/admin/coupons/actions.ts',
    ];
    for (const f of files) {
      const raw = readFileSync(path.join(process.cwd(), f), 'utf8');
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, `${f} 에 엄격 uuid 검증이 남아 있다`).not.toMatch(
        /z\.(string\(\)\.)?uuid\(\)/,
      );
    }
  });
});
