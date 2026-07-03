/**
 * Photo-wall layout persistence (FS-EC-04).
 *
 * localStorage draft following the `src/lib/editor/draft.ts` pattern:
 * versioned key + safe parse (zod) — corruption/schema drift NEVER blocks a
 * fresh session, it just discards the stale draft. Client-only: every
 * function is a no-op under SSR/node.
 *
 * Unlike editor drafts there is no TTL — frame PNG URLs are public Storage
 * assets (long-lived), not short-lived signed URLs.
 */

import { z } from 'zod';
import {
  WALL_DEFAULT_HEIGHT_CM,
  WALL_DEFAULT_WIDTH_CM,
  WALL_MAX_CM,
  WALL_MIN_CM,
} from './scale';

/** Bump the `.v1` suffix when the persisted shape changes incompatibly. */
export const WALL_STORAGE_KEY = 'frameshop.wall.v1';

// ---------- Schema (zod — localStorage is an untrusted IO boundary) ----------

export const placedWallItemSchema = z.object({
  /** Client-generated uuid for this placement. */
  id: z.string().min(1),
  productId: z.string().min(1),
  /** Representative variant (같은 sizeCode 중 최저가 1개). */
  variantId: z.string().min(1),
  sizeCode: z.string().min(1),
  sizeLabel: z.string(),
  /** Oriented physical size (portrait = tall, landscape = wide). */
  wMm: z.number().positive(),
  hMm: z.number().positive(),
  orientation: z.enum(['portrait', 'landscape']),
  colorCode: z.string().min(1),
  colorLabel: z.string(),
  /** frame_assets.png_url for the chosen colour. */
  frameUrl: z.string().min(1),
  /** Top-left corner in mm relative to the wall's top-left. */
  xMm: z.number().min(0),
  yMm: z.number().min(0),
  /** Representative price (studio resolves the exact variant price later). */
  price: z.number().min(0),
});

export const wallLayoutSchema = z.object({
  version: z.literal(1),
  /** ISO timestamp of the last save (informational — no TTL). */
  savedAt: z.string(),
  wall: z.object({
    widthCm: z.number().min(WALL_MIN_CM).max(WALL_MAX_CM),
    heightCm: z.number().min(WALL_MIN_CM).max(WALL_MAX_CM),
  }),
  items: z.array(placedWallItemSchema),
});

export type PlacedWallItem = z.infer<typeof placedWallItemSchema>;
export type WallLayout = z.infer<typeof wallLayoutSchema>;

// ---------- Persistence ----------

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Persist the wall layout. A pristine state (no items + default wall size)
 * clears the draft instead — nothing worth restoring. Best-effort: never
 * throws (quota/serialisation errors are swallowed).
 */
export function saveWallLayout(
  snapshot: Omit<WallLayout, 'version' | 'savedAt'>,
): void {
  if (!hasLocalStorage()) return;
  try {
    const pristine =
      snapshot.items.length === 0 &&
      snapshot.wall.widthCm === WALL_DEFAULT_WIDTH_CM &&
      snapshot.wall.heightCm === WALL_DEFAULT_HEIGHT_CM;
    if (pristine) {
      safeRemove(WALL_STORAGE_KEY);
      return;
    }
    const layout: WallLayout = {
      version: 1,
      savedAt: new Date().toISOString(),
      wall: snapshot.wall,
      items: snapshot.items,
    };
    window.localStorage.setItem(WALL_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Quota exceeded / serialisation issue — persistence is best-effort.
  }
}

/**
 * Load the saved layout. Returns null when absent or structurally invalid
 * (invalid data is discarded so it never blocks a fresh session).
 */
export function loadWallLayout(): WallLayout | null {
  if (!hasLocalStorage()) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(WALL_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemove(WALL_STORAGE_KEY);
    return null;
  }

  const result = wallLayoutSchema.safeParse(parsed);
  if (!result.success) {
    safeRemove(WALL_STORAGE_KEY);
    return null;
  }
  return result.data;
}

export function clearWallLayout(): void {
  if (!hasLocalStorage()) return;
  safeRemove(WALL_STORAGE_KEY);
}
