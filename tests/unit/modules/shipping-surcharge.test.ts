/**
 * classifyZip / calcSurcharge — 제주/도서산간 추가 배송비 순수 함수 (FS-EC-00).
 *
 * 근거: migration 030 (STANDARD 전용, PICKUP/QUICK 0; 제주 63xxx),
 * src/lib/shipping/surcharge.ts 대표 도서산간 범위.
 */

import { describe, expect, it } from 'vitest';
import { classifyZip, calcSurcharge } from '@/lib/shipping/surcharge';
import type { ZipRegion } from '@/lib/shipping/surcharge';

describe('classifyZip', () => {
  it('classifies Jeju range boundaries (63000–63644)', () => {
    expect(classifyZip('63000')).toBe('jeju');
    expect(classifyZip('63644')).toBe('jeju');
    expect(classifyZip('63321')).toBe('jeju'); // 제주시 한복판
  });

  it('classifies zips just outside the Jeju range as mainland', () => {
    expect(classifyZip('62999')).toBe('mainland');
    expect(classifyZip('63645')).toBe('mainland');
  });

  it('classifies representative remote islands as remote', () => {
    expect(classifyZip('23004')).toBe('remote'); // 백령도(옹진)
    expect(classifyZip('23010')).toBe('remote'); // 백령면 상한
    expect(classifyZip('23100')).toBe('remote'); // 연평면 일대
    expect(classifyZip('40200')).toBe('remote'); // 울릉도 하한
    expect(classifyZip('40240')).toBe('remote'); // 울릉도 상한
  });

  it('classifies ordinary mainland zips as mainland', () => {
    expect(classifyZip('06236')).toBe('mainland'); // 서울 강남
    expect(classifyZip('23003')).toBe('mainland'); // 옹진 범위 직전
    expect(classifyZip('40241')).toBe('mainland'); // 울릉 범위 직후
  });

  it('falls back to mainland for invalid input (PICKUP empty zip 등)', () => {
    expect(classifyZip('')).toBe('mainland');
    expect(classifyZip('1234')).toBe('mainland');
    expect(classifyZip('123456')).toBe('mainland');
    expect(classifyZip('abcde')).toBe('mainland');
  });
});

describe('calcSurcharge', () => {
  const standard = {
    code: 'STANDARD' as const,
    surchargeFeeJeju: 3000,
    surchargeFeeRemote: 5000,
  };

  it('charges the Jeju fee for STANDARD to Jeju', () => {
    expect(calcSurcharge('jeju', standard)).toBe(3000);
  });

  it('charges the remote fee for STANDARD to remote islands', () => {
    expect(calcSurcharge('remote', standard)).toBe(5000);
  });

  it('charges nothing for STANDARD to mainland', () => {
    expect(calcSurcharge('mainland', standard)).toBe(0);
  });

  it('never charges PICKUP or QUICK regardless of region (030 주석)', () => {
    const regions: ZipRegion[] = ['mainland', 'jeju', 'remote'];
    for (const region of regions) {
      expect(calcSurcharge(region, { ...standard, code: 'PICKUP' })).toBe(0);
      expect(calcSurcharge(region, { ...standard, code: 'QUICK' })).toBe(0);
    }
  });

  it('falls back to 0 when fees are absent (030 미적용 graceful)', () => {
    expect(calcSurcharge('jeju', { code: 'STANDARD' })).toBe(0);
    expect(calcSurcharge('remote', { code: 'STANDARD' })).toBe(0);
  });
});
