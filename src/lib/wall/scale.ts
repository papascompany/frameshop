/**
 * Photo-wall simulator — pure scale/placement math (FS-EC-04).
 *
 * NO Konva imports here (ADR-015 keeps Konva inside src/modules/**).
 * Everything renders off a SINGLE scale factor `pxPerMm` so the wall and
 * every placed frame keep true relative proportions (비율 왜곡 금지).
 *
 * Coordinate convention: item (xMm, yMm) = the frame's TOP-LEFT corner in mm,
 * relative to the wall's top-left corner.
 */

// ---------- Wall constants ----------

/** Wall dimension input range (cm). */
export const WALL_MIN_CM = 100;
export const WALL_MAX_CM = 1000;

/** Default wall preset: 300 × 230 cm. */
export const WALL_DEFAULT_WIDTH_CM = 300;
export const WALL_DEFAULT_HEIGHT_CM = 230;

/** Hanging guide: standard gallery eye level, measured from the FLOOR. */
export const EYE_LEVEL_CM = 145;

// ---------- Basic units ----------

export type SizeMm = { wMm: number; hMm: number };
export type PointMm = { xMm: number; yMm: number };

export function cmToMm(cm: number): number {
  return cm * 10;
}

/**
 * Single scale factor: CSS pixels per millimetre for a stage of
 * `stageWidthPx` showing a wall of `wallWidthMm`. Returns 0 for degenerate
 * inputs so callers can bail out instead of dividing by zero.
 */
export function pxPerMm(stageWidthPx: number, wallWidthMm: number): number {
  if (!Number.isFinite(stageWidthPx) || !Number.isFinite(wallWidthMm)) return 0;
  if (stageWidthPx <= 0 || wallWidthMm <= 0) return 0;
  return stageWidthPx / wallWidthMm;
}

/** mm → px using the single scale factor. */
export function mmToPx(mm: number, scale: number): number {
  return mm * scale;
}

/**
 * Clamp a wall dimension input (cm) into [WALL_MIN_CM, WALL_MAX_CM].
 * Non-finite input (empty/garbled field) falls back to the minimum so the
 * canvas never receives a NaN dimension.
 */
export function clampWallCm(cm: number): number {
  if (!Number.isFinite(cm)) return WALL_MIN_CM;
  return Math.min(WALL_MAX_CM, Math.max(WALL_MIN_CM, Math.round(cm)));
}

// ---------- Orientation ----------

export type WallOrientation = 'portrait' | 'landscape';

/**
 * Effective frame mm for an orientation. Mirrors the editor's convention
 * (FrameCanvas.orientedFrameMm): portrait = tall, landscape = wide —
 * regardless of how the variant row stores width/height.
 */
export function orientedSizeMm(
  widthMm: number,
  heightMm: number,
  orientation: WallOrientation,
): SizeMm {
  const lo = Math.min(widthMm, heightMm);
  const hi = Math.max(widthMm, heightMm);
  return orientation === 'landscape' ? { wMm: hi, hMm: lo } : { wMm: lo, hMm: hi };
}

// ---------- Placement ----------

/**
 * Clamp a frame's top-left position so the frame stays fully inside the
 * wall. If the frame is larger than the wall on an axis, it pins to 0
 * (top/left) rather than going negative.
 */
export function clampToWall(pos: PointMm, size: SizeMm, wall: SizeMm): PointMm {
  const maxX = Math.max(0, wall.wMm - size.wMm);
  const maxY = Math.max(0, wall.hMm - size.hMm);
  return {
    xMm: Math.min(Math.max(pos.xMm, 0), maxX),
    yMm: Math.min(Math.max(pos.yMm, 0), maxY),
  };
}

/** Cascade step for successive placements so new frames don't stack exactly. */
const PLACEMENT_CASCADE_STEP_MM = 60;

/**
 * Initial placement for the Nth added frame: wall centre, cascading down-right
 * by 60 mm per existing item, clamped inside the wall.
 */
export function initialPlacementMm(
  size: SizeMm,
  wall: SizeMm,
  index: number,
): PointMm {
  const offset = PLACEMENT_CASCADE_STEP_MM * Math.max(0, index);
  return clampToWall(
    {
      xMm: (wall.wMm - size.wMm) / 2 + offset,
      yMm: (wall.hMm - size.hMm) / 2 + offset,
    },
    size,
    wall,
  );
}

// ---------- Hanging guides ----------

/**
 * Y position (mm from wall TOP) of the 145 cm eye-level line, or null when
 * the wall is shorter than eye level (line would fall outside the wall).
 * Eye level is measured from the floor; the wall's bottom edge is assumed
 * to sit on the floor.
 */
export function eyeLevelYMm(wallHeightMm: number): number | null {
  const fromTop = wallHeightMm - cmToMm(EYE_LEVEL_CM);
  if (fromTop < 0 || fromTop > wallHeightMm) return null;
  return fromTop;
}
