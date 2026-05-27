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
import type { Photo } from '@/types/photo';
import type { CropTransform } from '@/types/editor';

type State = {
  productId: ProductId | null;
  photo: Photo | null;
  photoId: PhotoId | null;
  options: OptionMatrix | null;
  selectedOptions: SelectedOptions;
  selectedVariantId: ProductVariantId | null;
  cropTransform: CropTransform;
  previewDataUrl: string | null;
  isProcessing: boolean;
};

type Actions = {
  init: (args: {
    productId: ProductId;
    options: OptionMatrix;
    defaultVariantId: ProductVariantId | null;
  }) => void;
  setPhoto: (photo: Photo) => void;
  setColor: (code: string) => void;
  setSize: (code: string) => void;
  setMatte: (code: 'none' | 'with') => void;
  setPaper: (code: 'glossy' | 'matte' | 'fineart') => void;
  setCropTransform: (t: CropTransform) => void;
  setPreviewDataUrl: (url: string | null) => void;
  setProcessing: (flag: boolean) => void;
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
  setPhoto: (photo) => set({ photo, photoId: photo.id }),
  setColor: (code) =>
    set((s) => {
      const variantId = resolveVariant(s, { colorCode: code });
      if (!variantId) return s; // rollback
      return {
        selectedOptions: { ...s.selectedOptions, colorCode: code },
        selectedVariantId: variantId,
      };
    }),
  setSize: (code) =>
    set((s) => {
      const variantId = resolveVariant(s, { sizeCode: code });
      if (!variantId) return s;
      return {
        selectedOptions: { ...s.selectedOptions, sizeCode: code },
        selectedVariantId: variantId,
      };
    }),
  setMatte: (code) =>
    set((s) => {
      const variantId = resolveVariant(s, { matteCode: code });
      if (!variantId) return s;
      return {
        selectedOptions: { ...s.selectedOptions, matteCode: code },
        selectedVariantId: variantId,
      };
    }),
  setPaper: (code) =>
    set((s) => {
      const variantId = resolveVariant(s, { paperCode: code });
      if (!variantId) return s;
      return {
        selectedOptions: { ...s.selectedOptions, paperCode: code },
        selectedVariantId: variantId,
      };
    }),
  setCropTransform: (t) => set({ cropTransform: t }),
  setPreviewDataUrl: (url) => set({ previewDataUrl: url }),
  setProcessing: (flag) => set({ isProcessing: flag }),
  reset: () => set(initial),
}));

export function useCurrentVariantPrice(): number {
  return useEditorStore((s) => {
    if (!s.options || !s.selectedVariantId) return 0;
    return s.options.variantsByKey[variantKey(s.selectedOptions)]?.price ?? 0;
  });
}
