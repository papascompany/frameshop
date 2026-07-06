/**
 * OrderItemSnapshot zod schema tests (ADR-025 — 확장형 P1 묶음 스냅샷 동결).
 *
 * variant_snapshot(jsonb)은 마이그레이션 035 미적용에서도 묶음 정보(orientation/
 * projectSeq/groupLabel)를 보존하는 유일한 경로다. 신규 필드는 전부 옵셔널 —
 * 레거시/단품 스냅샷이 계속 통과해야 한다(FROZEN 무파손 계약).
 */

import { describe, expect, it } from 'vitest';
import { orderItemSnapshotSchema } from '@/types/order';

const LEGACY_SNAPSHOT = {
  productId: 'prod-1',
  variantId: 'variant-1',
  productName: '클래식 프레임',
  options: {
    sizeCode: 'A4',
    colorCode: 'BLACK',
    matteCode: 'none',
    paperCode: 'glossy',
  },
  sizeLabel: 'A4',
  colorLabel: '블랙',
  unitPrice: 39000,
} as const;

describe('orderItemSnapshotSchema (ADR-025 옵셔널 확장)', () => {
  it('accepts a legacy snapshot without any of the new optional fields', () => {
    const result = orderItemSnapshotSchema.safeParse(LEGACY_SNAPSHOT);
    expect(result.success).toBe(true);
  });

  it('accepts and preserves the 묶음 스냅샷 fields (orientation/projectSeq/groupLabel)', () => {
    const result = orderItemSnapshotSchema.safeParse({
      ...LEGACY_SNAPSHOT,
      bleedMm: 3,
      sourcePhotoId: 'photo-src-1',
      orientation: 'landscape',
      projectSeq: 2,
      groupLabel: '묶음 A',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orientation).toBe('landscape');
      expect(result.data.projectSeq).toBe(2);
      expect(result.data.groupLabel).toBe('묶음 A');
    }
  });

  it('accepts projectSeq 0 (0-base 첫 라인)', () => {
    const result = orderItemSnapshotSchema.safeParse({
      ...LEGACY_SNAPSHOT,
      orientation: 'portrait',
      projectSeq: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an orientation outside the migration 035 CHECK vocabulary', () => {
    const result = orderItemSnapshotSchema.safeParse({
      ...LEGACY_SNAPSHOT,
      orientation: 'diagonal',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative or fractional projectSeq', () => {
    expect(
      orderItemSnapshotSchema.safeParse({ ...LEGACY_SNAPSHOT, projectSeq: -1 })
        .success,
    ).toBe(false);
    expect(
      orderItemSnapshotSchema.safeParse({ ...LEGACY_SNAPSHOT, projectSeq: 1.5 })
        .success,
    ).toBe(false);
  });

  it('rejects an empty groupLabel (있으면 비어 있지 않아야 한다)', () => {
    const result = orderItemSnapshotSchema.safeParse({
      ...LEGACY_SNAPSHOT,
      groupLabel: '',
    });
    expect(result.success).toBe(false);
  });
});
