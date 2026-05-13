/**
 * Curation — active/inactive 필터링 및 DB 연동 로직 테스트.
 *
 * getActiveCurations 자체는 Supabase에 의존하므로 직접 호출하지 않고,
 * 큐레이션 페이로드 파싱 및 어댑터 로직을 순수 함수로 검증한다.
 */

import { describe, expect, it } from 'vitest';
import {
  bannerPayloadSchema,
  collectionPayloadSchema,
  featurePayloadSchema,
} from '@/types/curation';
import type { Curation, BannerPayload } from '@/types/curation';
import type { IsoTimestamp, CurationId } from '@/types/common';
import { asBrand } from '@/types/common';

// ── 테스트용 Curation fixture ─────────────────────────────────────────────────

function makeCuration(overrides: Partial<Curation> = {}): Curation {
  return {
    id: asBrand<CurationId>('curation-1'),
    type: 'banner',
    title: '테스트 배너',
    payload: {
      imageUrl: 'https://example.com/banner.jpg',
    } satisfies BannerPayload,
    device: 'all',
    startAt: null,
    endAt: null,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date().toISOString() as IsoTimestamp,
    ...overrides,
  };
}

// ── Zod 스키마 검증 테스트 ────────────────────────────────────────────────────

describe('bannerPayloadSchema', () => {
  it('https URL은 통과한다', () => {
    const result = bannerPayloadSchema.safeParse({
      imageUrl: 'https://example.com/image.jpg',
      title: '배너 제목',
    });
    expect(result.success).toBe(true);
  });

  it('http URL은 거부한다', () => {
    const result = bannerPayloadSchema.safeParse({
      imageUrl: 'http://example.com/image.jpg',
    });
    expect(result.success).toBe(false);
  });

  it('imageUrl이 없으면 거부한다', () => {
    const result = bannerPayloadSchema.safeParse({ title: '제목만' });
    expect(result.success).toBe(false);
  });
});

describe('collectionPayloadSchema', () => {
  it('productIds 배열이 있으면 통과한다', () => {
    const result = collectionPayloadSchema.safeParse({
      productIds: ['prod-1', 'prod-2'],
    });
    expect(result.success).toBe(true);
  });

  it('빈 productIds는 거부한다', () => {
    const result = collectionPayloadSchema.safeParse({ productIds: [] });
    expect(result.success).toBe(false);
  });

  it('21개 이상 productIds는 거부한다', () => {
    const result = collectionPayloadSchema.safeParse({
      productIds: Array.from({ length: 21 }, (_, i) => `prod-${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe('featurePayloadSchema', () => {
  it('productId + pitch가 있으면 통과한다', () => {
    const result = featurePayloadSchema.safeParse({
      productId: 'prod-1',
      pitch: '이 달의 추천 액자',
    });
    expect(result.success).toBe(true);
  });

  it('pitch가 없으면 거부한다', () => {
    const result = featurePayloadSchema.safeParse({ productId: 'prod-1' });
    expect(result.success).toBe(false);
  });
});

// ── 큐레이션 active/inactive 필터 로직 테스트 ────────────────────────────────

describe('getActiveCurations 필터 조건 (비즈니스 로직)', () => {
  /** getActiveCurations 에서 사용하는 필터링 조건을 순수 함수로 추출 */
  function isActiveCuration(
    c: Curation,
    now: Date = new Date(),
  ): boolean {
    if (!c.isActive) return false;
    if (c.startAt && new Date(c.startAt) > now) return false;
    if (c.endAt && new Date(c.endAt) <= now) return false;
    return true;
  }

  it('isActive=true + 기간 없음 → 활성', () => {
    expect(isActiveCuration(makeCuration())).toBe(true);
  });

  it('isActive=false → 비활성', () => {
    expect(isActiveCuration(makeCuration({ isActive: false }))).toBe(false);
  });

  it('startAt이 미래 → 아직 비활성', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60) as unknown as IsoTimestamp;
    const c = makeCuration({ startAt: future.toString() as IsoTimestamp });
    expect(isActiveCuration(c)).toBe(false);
  });

  it('endAt이 과거 → 만료됨', () => {
    const past = new Date(Date.now() - 1000) as unknown as IsoTimestamp;
    const c = makeCuration({ endAt: past.toString() as IsoTimestamp });
    expect(isActiveCuration(c)).toBe(false);
  });

  it('startAt=과거, endAt=미래 → 활성', () => {
    const past = new Date(Date.now() - 1000).toISOString() as IsoTimestamp;
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString() as IsoTimestamp;
    const c = makeCuration({ startAt: past, endAt: future });
    expect(isActiveCuration(c)).toBe(true);
  });
});
