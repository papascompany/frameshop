/**
 * Zustand wall-simulator store (client-only) — FS-EC-04.
 *
 * Holds the wall dimensions (cm) and the placed frames (mm coordinates).
 * Persistence lives in `src/lib/wall/storage.ts` (localStorage, versioned
 * key + safe parse) and is driven by WallClient effects — the store itself
 * stays synchronous/pure like `src/store/editor.ts`.
 *
 * Z-order = array order = 추가순 (겹침 허용, 스펙 §4).
 */

'use client';

import { create } from 'zustand';
import {
  WALL_DEFAULT_HEIGHT_CM,
  WALL_DEFAULT_WIDTH_CM,
  clampToWall,
  clampWallCm,
  cmToMm,
  initialPlacementMm,
} from '@/lib/wall/scale';
import type { PlacedWallItem } from '@/lib/wall/storage';

type State = {
  wallWidthCm: number;
  wallHeightCm: number;
  items: PlacedWallItem[];
  /** Currently selected placement (canvas highlight + list highlight). */
  selectedId: string | null;
};

type Actions = {
  /** Clamps to 100~1000 cm and re-clamps every placed item into the new wall. */
  setWallSize: (widthCm: number, heightCm: number) => void;
  /** Place a new frame at the wall centre (cascading), select it. */
  addItem: (input: Omit<PlacedWallItem, 'id' | 'xMm' | 'yMm'>) => void;
  /** Commit a drag — clamped inside the wall. */
  moveItem: (id: string, xMm: number, yMm: number) => void;
  removeItem: (id: string) => void;
  select: (id: string | null) => void;
  /** Restore a persisted layout (already schema-validated by loadWallLayout). */
  hydrate: (layout: {
    widthCm: number;
    heightCm: number;
    items: PlacedWallItem[];
  }) => void;
  clear: () => void;
  reset: () => void;
};

const initial: State = {
  wallWidthCm: WALL_DEFAULT_WIDTH_CM,
  wallHeightCm: WALL_DEFAULT_HEIGHT_CM,
  items: [],
  selectedId: null,
};

export const useWallStore = create<State & Actions>((set) => ({
  ...initial,
  setWallSize: (widthCm, heightCm) =>
    set((s) => {
      const w = clampWallCm(widthCm);
      const h = clampWallCm(heightCm);
      const wall = { wMm: cmToMm(w), hMm: cmToMm(h) };
      return {
        wallWidthCm: w,
        wallHeightCm: h,
        items: s.items.map((item) => ({
          ...item,
          ...clampToWall(
            { xMm: item.xMm, yMm: item.yMm },
            { wMm: item.wMm, hMm: item.hMm },
            wall,
          ),
        })),
      };
    }),
  addItem: (input) =>
    set((s) => {
      const wall = { wMm: cmToMm(s.wallWidthCm), hMm: cmToMm(s.wallHeightCm) };
      const pos = initialPlacementMm(
        { wMm: input.wMm, hMm: input.hMm },
        wall,
        s.items.length,
      );
      const item: PlacedWallItem = {
        ...input,
        id: crypto.randomUUID(),
        xMm: pos.xMm,
        yMm: pos.yMm,
      };
      return { items: [...s.items, item], selectedId: item.id };
    }),
  moveItem: (id, xMm, yMm) =>
    set((s) => {
      const wall = { wMm: cmToMm(s.wallWidthCm), hMm: cmToMm(s.wallHeightCm) };
      return {
        items: s.items.map((item) =>
          item.id === id
            ? {
                ...item,
                ...clampToWall({ xMm, yMm }, { wMm: item.wMm, hMm: item.hMm }, wall),
              }
            : item,
        ),
      };
    }),
  removeItem: (id) =>
    set((s) => ({
      items: s.items.filter((item) => item.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),
  select: (id) => set({ selectedId: id }),
  hydrate: (layout) =>
    set(() => {
      const w = clampWallCm(layout.widthCm);
      const h = clampWallCm(layout.heightCm);
      const wall = { wMm: cmToMm(w), hMm: cmToMm(h) };
      return {
        wallWidthCm: w,
        wallHeightCm: h,
        selectedId: null,
        items: layout.items.map((item) => ({
          ...item,
          ...clampToWall(
            { xMm: item.xMm, yMm: item.yMm },
            { wMm: item.wMm, hMm: item.hMm },
            wall,
          ),
        })),
      };
    }),
  clear: () => set({ items: [], selectedId: null }),
  reset: () => set(initial),
}));

/**
 * Totals for the bottom bar. Primitive selectors (count / sum) keep the
 * store comparison Object.is-stable — same pattern as useEditorTotals.
 */
export function useWallTotals(): { count: number; totalPrice: number } {
  const count = useWallStore((s) => s.items.length);
  const totalPrice = useWallStore((s) =>
    s.items.reduce((sum, item) => sum + item.price, 0),
  );
  return { count, totalPrice };
}
