/**
 * Zustand editor store (client-only).
 *
 * Spec: docs/specs/editor.md, "editorStore" interface.
 */

'use client';

import { create } from 'zustand';
import type {
  PhotoId,
  ProductId,
  ProductVariantId,
} from '@/types/common';
import {
  variantKey,
  type OptionMatrix,
  type SelectedOptions,
} from '@/types/product';
import { CART_QUANTITY_MAX, CART_QUANTITY_MIN } from '@/types/cart';
import type { Photo } from '@/types/photo';
import type { CropTransform, EditorPhotoEntry } from '@/types/editor';

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return CART_QUANTITY_MIN;
  const i = Math.round(n);
  if (i < CART_QUANTITY_MIN) return CART_QUANTITY_MIN;
  if (i > CART_QUANTITY_MAX) return CART_QUANTITY_MAX;
  return i;
}

type State = {
  productId: ProductId | null;
  /** The photo currently being placed on the canvas (pre-"담기"). */
  photo: Photo | null;
  photoId: PhotoId | null;
  options: OptionMatrix | null;
  selectedOptions: SelectedOptions;
  selectedVariantId: ProductVariantId | null;
  cropTransform: CropTransform;
  previewDataUrl: string | null;
  isProcessing: boolean;
  /**
   * Confirmed print-ready crop of the ACTIVE photo (full-res crop of the print
   * area + bleed). Set by "담기". Cleared on any transform/option edit so the
   * active photo is re-confirmed before it joins the tray.
   */
  confirmedCrop: Photo | null;
  /**
   * The order tray — confirmed photos waiting to be added to the cart together.
   * All entries share `selectedOptions`/`selectedVariantId`. Cleared when SIZE
   * changes (crop geometry no longer matches).
   */
  entries: EditorPhotoEntry[];
  /**
   * Frame orientation. The size SKU (4×6 등) is a physical frame that can hang
   * either way; 'portrait' = tall, 'landscape' = wide. Auto-matched to the
   * photo's aspect on load (가로 사진 → 가로 틀). Changing it swaps the crop
   * aspect, so the tray is cleared (like a size change).
   */
  orientation: FrameOrientation;
};

export type FrameOrientation = 'portrait' | 'landscape';

type Actions = {
  init: (args: {
    productId: ProductId;
    options: OptionMatrix;
    defaultVariantId: ProductVariantId | null;
  }) => void;
  setPhoto: (photo: Photo) => void;
  /** Drop the active photo without adding it (e.g. start over / after 담기). */
  clearActivePhoto: () => void;
  /** Switch portrait/landscape. Clears the tray (crop aspect changes). */
  setOrientation: (o: FrameOrientation) => void;
  setColor: (code: string) => void;
  setSize: (code: string) => void;
  setMatte: (code: 'none' | 'with') => void;
  setPaper: (code: 'glossy' | 'matte' | 'fineart') => void;
  setCropTransform: (t: CropTransform) => void;
  setPreviewDataUrl: (url: string | null) => void;
  setProcessing: (flag: boolean) => void;
  setConfirmedCrop: (photo: Photo | null) => void;
  /** Push a confirmed photo into the tray (qty 1) and clear the active photo. */
  addEntry: (entry: { photo: Photo; previewUrl: string }) => void;
  removeEntry: (entryId: string) => void;
  setEntryQuantity: (entryId: string, quantity: number) => void;
  clearEntries: () => void;
  reset: () => void;
};

const initial: State = {
  productId: null,
  photo: null,
  photoId: null,
  options: null,
  selectedOptions: {
    sizeCode: '',
    colorCode: '',
    matteCode: 'none',
    paperCode: 'glossy',
  },
  selectedVariantId: null,
  cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
  previewDataUrl: null,
  isProcessing: false,
  confirmedCrop: null,
  entries: [],
  orientation: 'portrait',
};

function resolveVariant(state: State, partial: Partial<SelectedOptions>): ProductVariantId | null {
  if (!state.options) return state.selectedVariantId;
  const next = { ...state.selectedOptions, ...partial };
  const v = state.options.variantsByKey[variantKey(next)];
  return v ? v.id : null;
}

export const useEditorStore = create<State & Actions>((set) => ({
  ...initial,
  init: ({ productId, options, defaultVariantId }) => {
    // Derive selectedOptions from the default variant so that selectedVariantId
    // and selectedOptions always refer to the same variant.  Falling back to the
    // first entry in variantsByKey (by insertion order) only when there is no
    // defaultVariantId (edge-case: empty catalogue).
    const defaultVariant = defaultVariantId
      ? Object.values(options.variantsByKey).find((v) => v.id === defaultVariantId) ?? null
      : null;
    const seed = defaultVariant ?? Object.values(options.variantsByKey)[0] ?? null;
    set({
      productId,
      options,
      selectedVariantId: defaultVariantId,
      selectedOptions: seed
        ? {
            sizeCode: seed.sizeCode,
            colorCode: seed.colorCode,
            matteCode: seed.matteCode,
            paperCode: seed.paperCode,
          }
        : initial.selectedOptions,
    });
  },
  setPhoto: (photo) =>
    set((s) => {
      // #2 가로/세로 자동 매칭: 트레이가 비어 있을 때만 사진 방향으로 틀 방향을
      // 맞춘다(이미 담은 사진들의 방향을 깨지 않기 위해). 치수를 모르면 유지.
      let orientation = s.orientation;
      if (
        s.entries.length === 0 &&
        typeof photo.widthPx === 'number' &&
        typeof photo.heightPx === 'number' &&
        photo.widthPx > 0 &&
        photo.heightPx > 0
      ) {
        orientation = photo.widthPx > photo.heightPx ? 'landscape' : 'portrait';
      }
      return { photo, photoId: photo.id, confirmedCrop: null, orientation };
    }),
  clearActivePhoto: () =>
    set({
      photo: null,
      photoId: null,
      confirmedCrop: null,
      cropTransform: initial.cropTransform,
    }),
  setOrientation: (o) =>
    set((s) => {
      if (o === s.orientation) return s;
      // Swapping the frame aspect invalidates baked crops → clear the tray.
      return { orientation: o, confirmedCrop: null, entries: [] };
    }),
  setColor: (code) =>
    set((s) => {
      const variantId = resolveVariant(s, { colorCode: code });
      if (!variantId) return s; // rollback
      // Colour does not change crop geometry — tray entries survive.
      return {
        selectedOptions: { ...s.selectedOptions, colorCode: code },
        selectedVariantId: variantId,
        confirmedCrop: null,
      };
    }),
  setSize: (code) =>
    set((s) => {
      const variantId = resolveVariant(s, { sizeCode: code });
      if (!variantId) return s;
      // SIZE changes the frame aspect → already-baked crops no longer fit.
      // Clear the tray + active confirmed crop so photos are re-placed.
      return {
        selectedOptions: { ...s.selectedOptions, sizeCode: code },
        selectedVariantId: variantId,
        confirmedCrop: null,
        entries: [],
      };
    }),
  setMatte: (code) =>
    set((s) => {
      const variantId = resolveVariant(s, { matteCode: code });
      if (!variantId) return s;
      return {
        selectedOptions: { ...s.selectedOptions, matteCode: code },
        selectedVariantId: variantId,
        confirmedCrop: null,
      };
    }),
  setPaper: (code) =>
    set((s) => {
      const variantId = resolveVariant(s, { paperCode: code });
      if (!variantId) return s;
      return {
        selectedOptions: { ...s.selectedOptions, paperCode: code },
        selectedVariantId: variantId,
        confirmedCrop: null,
      };
    }),
  // Any transform edit invalidates a previously confirmed crop.
  setCropTransform: (t) => set({ cropTransform: t, confirmedCrop: null }),
  setPreviewDataUrl: (url) => set({ previewDataUrl: url }),
  setProcessing: (flag) => set({ isProcessing: flag }),
  setConfirmedCrop: (photo) => set({ confirmedCrop: photo }),
  addEntry: ({ photo, previewUrl }) =>
    set((s) => ({
      entries: [
        ...s.entries,
        { entryId: crypto.randomUUID(), photo, previewUrl, quantity: 1 },
      ],
      // Clear the active photo so the canvas is ready for the next one.
      photo: null,
      photoId: null,
      confirmedCrop: null,
      cropTransform: initial.cropTransform,
    })),
  removeEntry: (entryId) =>
    set((s) => ({ entries: s.entries.filter((e) => e.entryId !== entryId) })),
  setEntryQuantity: (entryId, quantity) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.entryId === entryId ? { ...e, quantity: clampQty(quantity) } : e,
      ),
    })),
  clearEntries: () => set({ entries: [] }),
  reset: () => set(initial),
}));

export function useCurrentVariantPrice(): number {
  return useEditorStore((s) => {
    if (!s.options || !s.selectedVariantId) return 0;
    return s.options.variantsByKey[variantKey(s.selectedOptions)]?.price ?? 0;
  });
}

/**
 * Running totals across the tray (+ the active photo if it's already confirmed
 * but not yet pushed). Quantity is the sum of entry quantities; price is
 * quantity × current unit price.
 */
export function useEditorTotals(): { totalQuantity: number; totalPrice: number } {
  const unitPrice = useCurrentVariantPrice();
  // Select a PRIMITIVE (sum) so the store comparison stays Object.is-stable;
  // build the result object in the hook body, not the selector.
  const totalQuantity = useEditorStore((s) =>
    s.entries.reduce((sum, e) => sum + e.quantity, 0),
  );
  return { totalQuantity, totalPrice: totalQuantity * unitPrice };
}
