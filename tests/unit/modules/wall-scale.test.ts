/**
 * Wall simulator pure scale/placement math (FS-EC-04).
 *
 * The invariant under test: a SINGLE px-per-mm factor drives both the wall
 * and every frame, so relative proportions are physically true (비율 왜곡 금지),
 * and placements always stay inside the wall.
 */

import { describe, expect, it } from 'vitest';
import {
  EYE_LEVEL_CM,
  WALL_DEFAULT_HEIGHT_CM,
  WALL_DEFAULT_WIDTH_CM,
  WALL_MAX_CM,
  WALL_MIN_CM,
  clampToWall,
  clampWallCm,
  cmToMm,
  eyeLevelYMm,
  initialPlacementMm,
  mmToPx,
  orientedSizeMm,
  pxPerMm,
} from '@/lib/wall/scale';

describe('pxPerMm / mmToPx', () => {
  it('stage 343px에 벽 3000mm → 단일 계수 0.11433…', () => {
    const s = pxPerMm(343, 3000);
    expect(s).toBeCloseTo(343 / 3000, 10);
  });

  it('같은 계수로 벽과 프레임을 렌더하면 비율이 보존된다', () => {
    const s = pxPerMm(343, 3000);
    // A4 액자(210×297mm)와 벽(3000mm)의 px 비율 = mm 비율
    expect(mmToPx(210, s) / mmToPx(3000, s)).toBeCloseTo(210 / 3000, 10);
    expect(mmToPx(297, s) / mmToPx(210, s)).toBeCloseTo(297 / 210, 10);
  });

  it('degenerate 입력(0/음수/NaN)은 0을 반환한다', () => {
    expect(pxPerMm(0, 3000)).toBe(0);
    expect(pxPerMm(343, 0)).toBe(0);
    expect(pxPerMm(-10, 3000)).toBe(0);
    expect(pxPerMm(Number.NaN, 3000)).toBe(0);
  });
});

describe('clampWallCm', () => {
  it('범위(100~1000cm)로 클램프한다', () => {
    expect(clampWallCm(50)).toBe(WALL_MIN_CM);
    expect(clampWallCm(1500)).toBe(WALL_MAX_CM);
    expect(clampWallCm(300)).toBe(300);
    expect(clampWallCm(100)).toBe(100);
    expect(clampWallCm(1000)).toBe(1000);
  });

  it('소수는 반올림, NaN은 최소값 폴백', () => {
    expect(clampWallCm(230.4)).toBe(230);
    expect(clampWallCm(Number.NaN)).toBe(WALL_MIN_CM);
  });

  it('기본 프리셋(300×230)은 범위 안에 있다', () => {
    expect(clampWallCm(WALL_DEFAULT_WIDTH_CM)).toBe(WALL_DEFAULT_WIDTH_CM);
    expect(clampWallCm(WALL_DEFAULT_HEIGHT_CM)).toBe(WALL_DEFAULT_HEIGHT_CM);
  });
});

describe('orientedSizeMm', () => {
  it('portrait = 세로가 긴 변, landscape = 가로가 긴 변', () => {
    expect(orientedSizeMm(102, 152, 'portrait')).toEqual({ wMm: 102, hMm: 152 });
    expect(orientedSizeMm(102, 152, 'landscape')).toEqual({ wMm: 152, hMm: 102 });
    // 저장된 축이 반대여도 결과는 동일 (에디터 orientedFrameMm 규약)
    expect(orientedSizeMm(152, 102, 'portrait')).toEqual({ wMm: 102, hMm: 152 });
  });
});

describe('clampToWall', () => {
  const wall = { wMm: 3000, hMm: 2300 };
  const size = { wMm: 210, hMm: 297 };

  it('벽 안이면 그대로 유지', () => {
    expect(clampToWall({ xMm: 100, yMm: 200 }, size, wall)).toEqual({
      xMm: 100,
      yMm: 200,
    });
  });

  it('음수 → 0으로 클램프', () => {
    expect(clampToWall({ xMm: -50, yMm: -1 }, size, wall)).toEqual({
      xMm: 0,
      yMm: 0,
    });
  });

  it('오른쪽/아래로 넘치면 (벽 - 프레임)으로 클램프', () => {
    expect(clampToWall({ xMm: 9999, yMm: 9999 }, size, wall)).toEqual({
      xMm: 3000 - 210,
      yMm: 2300 - 297,
    });
  });

  it('프레임이 벽보다 크면 0에 고정(음수 방지)', () => {
    const huge = { wMm: 5000, hMm: 5000 };
    expect(clampToWall({ xMm: 100, yMm: 100 }, huge, wall)).toEqual({
      xMm: 0,
      yMm: 0,
    });
  });
});

describe('initialPlacementMm', () => {
  const wall = { wMm: 3000, hMm: 2300 };
  const size = { wMm: 210, hMm: 297 };

  it('첫 배치는 벽 중앙', () => {
    expect(initialPlacementMm(size, wall, 0)).toEqual({
      xMm: (3000 - 210) / 2,
      yMm: (2300 - 297) / 2,
    });
  });

  it('N번째 배치는 캐스케이드되며 벽 안으로 클램프된다', () => {
    const p1 = initialPlacementMm(size, wall, 1);
    expect(p1.xMm).toBeGreaterThan((3000 - 210) / 2);
    const far = initialPlacementMm(size, wall, 1000);
    expect(far.xMm).toBeLessThanOrEqual(3000 - 210);
    expect(far.yMm).toBeLessThanOrEqual(2300 - 297);
  });
});

describe('eyeLevelYMm (걸이 가이드)', () => {
  it('벽 230cm → 위에서 850mm 지점(바닥에서 145cm)', () => {
    expect(eyeLevelYMm(cmToMm(230))).toBe(2300 - cmToMm(EYE_LEVEL_CM));
  });

  it('벽이 145cm보다 낮으면 null(가이드 생략)', () => {
    expect(eyeLevelYMm(cmToMm(100))).toBeNull();
  });

  it('벽 높이 = 눈높이면 0(벽 맨 위)', () => {
    expect(eyeLevelYMm(cmToMm(EYE_LEVEL_CM))).toBe(0);
  });
});
