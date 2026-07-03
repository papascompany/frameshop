/**
 * Wall layout localStorage persistence (FS-EC-04).
 *
 * Versioned key (frameshop.wall.v1) + zod safe-parse: corrupt/foreign data is
 * discarded (never blocks a fresh session), pristine state clears the key.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  WALL_STORAGE_KEY,
  clearWallLayout,
  loadWallLayout,
  saveWallLayout,
  wallLayoutSchema,
  type PlacedWallItem,
} from '@/lib/wall/storage';
import {
  WALL_DEFAULT_HEIGHT_CM,
  WALL_DEFAULT_WIDTH_CM,
} from '@/lib/wall/scale';

function item(partial: Partial<PlacedWallItem> = {}): PlacedWallItem {
  return {
    id: 'item-1',
    productId: 'prod-1',
    variantId: 'var-1',
    sizeCode: '4x6',
    sizeLabel: '4×6',
    wMm: 102,
    hMm: 152,
    orientation: 'portrait',
    colorCode: 'black',
    colorLabel: '블랙',
    frameUrl: 'https://cdn.example.com/frames/black.png',
    xMm: 1449,
    yMm: 1074,
    price: 19000,
    ...partial,
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('saveWallLayout / loadWallLayout 라운드트립', () => {
  it('저장한 레이아웃을 그대로 복원한다', () => {
    saveWallLayout({
      wall: { widthCm: 350, heightCm: 240 },
      items: [item(), item({ id: 'item-2', orientation: 'landscape', wMm: 152, hMm: 102 })],
    });
    const loaded = loadWallLayout();
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(1);
    expect(loaded?.wall).toEqual({ widthCm: 350, heightCm: 240 });
    expect(loaded?.items).toHaveLength(2);
    expect(loaded?.items[0]).toEqual(item());
  });

  it('pristine 상태(빈 items + 기본 벽)는 저장 대신 키를 제거한다', () => {
    saveWallLayout({ wall: { widthCm: 350, heightCm: 240 }, items: [item()] });
    expect(window.localStorage.getItem(WALL_STORAGE_KEY)).not.toBeNull();
    saveWallLayout({
      wall: { widthCm: WALL_DEFAULT_WIDTH_CM, heightCm: WALL_DEFAULT_HEIGHT_CM },
      items: [],
    });
    expect(window.localStorage.getItem(WALL_STORAGE_KEY)).toBeNull();
  });

  it('벽 치수만 바꿔도(아이템 0개) 저장된다', () => {
    saveWallLayout({ wall: { widthCm: 500, heightCm: 250 }, items: [] });
    expect(loadWallLayout()?.wall.widthCm).toBe(500);
  });
});

describe('안전 파싱 (버전키 + zod)', () => {
  it('손상된 JSON → null 반환 + 키 제거', () => {
    window.localStorage.setItem(WALL_STORAGE_KEY, '{corrupt!!');
    expect(loadWallLayout()).toBeNull();
    expect(window.localStorage.getItem(WALL_STORAGE_KEY)).toBeNull();
  });

  it('버전 불일치(v2) → 폐기', () => {
    window.localStorage.setItem(
      WALL_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        wall: { widthCm: 300, heightCm: 230 },
        items: [],
      }),
    );
    expect(loadWallLayout()).toBeNull();
  });

  it('스키마 위반 아이템(wMm ≤ 0, orientation 오타) → 폐기', () => {
    window.localStorage.setItem(
      WALL_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        wall: { widthCm: 300, heightCm: 230 },
        items: [{ ...item(), wMm: -5, orientation: 'diagonal' }],
      }),
    );
    expect(loadWallLayout()).toBeNull();
    expect(window.localStorage.getItem(WALL_STORAGE_KEY)).toBeNull();
  });

  it('벽 치수 범위 밖(widthCm 5000) → 폐기', () => {
    window.localStorage.setItem(
      WALL_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        wall: { widthCm: 5000, heightCm: 230 },
        items: [],
      }),
    );
    expect(loadWallLayout()).toBeNull();
  });

  it('wallLayoutSchema 는 유효한 페이로드를 통과시킨다', () => {
    const ok = wallLayoutSchema.safeParse({
      version: 1,
      savedAt: '2026-07-03T00:00:00.000Z',
      wall: { widthCm: 300, heightCm: 230 },
      items: [item()],
    });
    expect(ok.success).toBe(true);
  });
});

describe('clearWallLayout', () => {
  it('키를 제거한다', () => {
    saveWallLayout({ wall: { widthCm: 350, heightCm: 240 }, items: [item()] });
    clearWallLayout();
    expect(window.localStorage.getItem(WALL_STORAGE_KEY)).toBeNull();
    expect(loadWallLayout()).toBeNull();
  });
});
