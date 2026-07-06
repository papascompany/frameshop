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
import type { CropTransform, EditorKind, EditorPhotoEntry } from '@/types/editor';
import type { ProjectPhotoRef } from '@/types/project';

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return CART_QUANTITY_MIN;
  const i = Math.round(n);
  if (i < CART_QUANTITY_MIN) return CART_QUANTITY_MIN;
  if (i > CART_QUANTITY_MAX) return CART_QUANTITY_MAX;
  return i;
}

type State = {
  productId: ProductId | null;
  /**
   * ADR-025 (확장형 P1) — 편집 세션 모드. 'basic' = 현행 단품 편집기(회귀 0 —
   * setSize/setOrientation 의 트레이 초기화 등 현행 동작 문자 그대로),
   * 'extended' = 멀티포토 사진풀 + 라인별 독립 사이즈/방향/수량.
   * `init` 이 URL `mode` 파라미터로 결정하며 기본값은 'basic'.
   */
  kind: EditorKind;
  /**
   * ADR-025 — 확장형 사진풀. 라인(entries)과 독립적인 업로드 사진 참조 목록.
   * 라인을 만들거나 지워도 풀은 유지된다(같은 사진 → 다른 사이즈 N라인).
   * basic 세션에서는 항상 [].
   */
  photoPool: ProjectPhotoRef[];
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
   * basic: all entries share `selectedOptions`/`selectedVariantId`; cleared when
   * SIZE changes (crop geometry no longer matches).
   * extended(ADR-025): 각 라인이 담기 시점의 `selectedOptions`/`orientation`
   * 스냅샷을 가지므로 전역 옵션 변경에도 라인은 유지된다.
   */
  entries: EditorPhotoEntry[];
  /**
   * Frame orientation. The size SKU (4×6 등) is a physical frame that can hang
   * either way; 'portrait' = tall, 'landscape' = wide. Auto-matched to the
   * photo's aspect on load (가로 사진 → 가로 틀). Changing it swaps the crop
   * aspect, so the tray is cleared (like a size change).
   */
  orientation: FrameOrientation;
  /**
   * 선결과제 3: how many entries were just restored from a saved draft, for a
   * one-time "이어서 작업 중" notice. null = nothing restored. Kept in the store
   * (not React state) so the rehydrate effect can set it without a React
   * setState-in-effect (Next.js 16 / React 19 react-hooks rule).
   */
  restoredDraftCount: number | null;
};

export type FrameOrientation = 'portrait' | 'landscape';

/**
 * Best-fit 방향 제안(ADR-025 — 확장형 사진풀→라인 생성 기본값). 사진 종횡비 기준
 * 가로가 길면 'landscape', 그 외(정사각형 포함)는 'portrait'. `setPhoto` 의 자동
 * 매칭(#2 가로/세로)과 같은 규칙의 단일 소스. 순수 함수 — 치수를 모르거나(NaN)
 * 유효하지 않아도 안전하게 'portrait' 로 떨어진다.
 */
export function suggestOrientation(widthPx: number, heightPx: number): FrameOrientation {
  return widthPx > heightPx ? 'landscape' : 'portrait';
}

type Actions = {
  init: (args: {
    productId: ProductId;
    options: OptionMatrix;
    defaultVariantId: ProductVariantId | null;
    /**
     * ADR-025 — URL `mode` 로 결정되는 편집 세션 모드. 미지정 = 'basic'
     * (기존 호출부 시그니처 무파손 — 전부 basic 경로).
     */
    kind?: EditorKind;
  }) => void;
  setPhoto: (photo: Photo) => void;
  /** Drop the active photo without adding it (e.g. start over / after 담기). */
  clearActivePhoto: () => void;
  /** Switch portrait/landscape. Clears the tray (crop aspect changes) —
   *  basic 전용. extended 는 라인이 방향 스냅샷을 가지므로 트레이를 유지한다(ADR-025). */
  setOrientation: (o: FrameOrientation) => void;
  setColor: (code: string) => void;
  setSize: (code: string) => void;
  setMatte: (code: 'none' | 'with') => void;
  setPaper: (code: 'glossy' | 'matte' | 'fineart') => void;
  setCropTransform: (t: CropTransform) => void;
  setPreviewDataUrl: (url: string | null) => void;
  setProcessing: (flag: boolean) => void;
  setConfirmedCrop: (photo: Photo | null) => void;
  /** Push a confirmed photo into the tray (qty 1) and clear the active photo.
   *  `sourcePhotoId`/`sourcePhotoUrl`/`cropTransform` preserve the ORIGINAL photo
   *  + real crop transform (선결과제 1) so the line can be re-edited/re-ordered. */
  addEntry: (entry: {
    photo: Photo;
    previewUrl: string;
    sourcePhotoId?: PhotoId;
    sourcePhotoUrl?: string;
    cropTransform?: CropTransform;
  }) => void;
  removeEntry: (entryId: string) => void;
  setEntryQuantity: (entryId: string, quantity: number) => void;
  clearEntries: () => void;
  /** ADR-025 — 사진풀에 참조 추가. 같은 photoId 가 이미 있으면 교체(upsert)해
   *  풀을 photoId-유일하게 유지한다(재업로드/재선택 중복 방지). */
  addPhotoToPool: (ref: ProjectPhotoRef) => void;
  /** ADR-025 — 풀에서만 제거. 이 사진으로 이미 만든 라인(entries)은 유지된다. */
  removeFromPool: (photoId: PhotoId) => void;
  /** ADR-025 — 특정 라인의 옵션/방향 스냅샷 교체. variant 존재 검증은 하지 않는다
   *  (비활성 조합도 담아두고 UI 가 `useLineAvailability` 로 경고 — 가격은 0). */
  updateLineOptions: (
    entryId: string,
    selectedOptions: SelectedOptions,
    orientation: FrameOrientation,
  ) => void;
  /** ADR-025 — 라인 복제(새 entryId 부여, 원본 바로 뒤에 삽입). */
  duplicateLine: (entryId: string) => void;
  /** ADR-025 — 모든 라인에 옵션 일괄 적용. 방향(orientation)은 라인별 유지. */
  applyOptionsToAllLines: (selectedOptions: SelectedOptions) => void;
  /** Rehydrate a saved draft (선결과제 3) — restores tray + options/orientation
   *  without touching the option matrix or productId seeded by `init`.
   *  ADR-025(v2): `kind`/`photoPool` 미지정(레거시 basic 호출부)이면 현재 값 유지
   *  — `init` 이 URL mode 로 이미 kind 를 세팅했고 basic 의 pool 은 항상 []. */
  restoreDraft: (draft: {
    entries: EditorPhotoEntry[];
    selectedOptions: SelectedOptions;
    selectedVariantId: ProductVariantId | null;
    orientation: FrameOrientation;
    kind?: EditorKind;
    photoPool?: ProjectPhotoRef[];
  }) => void;
  /** 초기 상태로 복원. ADR-025: `kind` 지정 시 해당 모드로 리셋(미지정 = 'basic'
   *  — 기존 호출부 `reset()` 은 현행 동작 그대로). */
  reset: (kind?: EditorKind) => void;
};

const initial: State = {
  productId: null,
  kind: 'basic',
  photoPool: [],
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
  restoredDraftCount: null,
};

function resolveVariant(state: State, partial: Partial<SelectedOptions>): ProductVariantId | null {
  if (!state.options) return state.selectedVariantId;
  const next = { ...state.selectedOptions, ...partial };
  const v = state.options.variantsByKey[variantKey(next)];
  return v ? v.id : null;
}

export const useEditorStore = create<State & Actions>((set) => ({
  ...initial,
  init: ({ productId, options, defaultVariantId, kind }) => {
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
      // ADR-025: URL mode 가 세션 모드를 결정. 미지정 = 'basic'(기존 호출부 무파손).
      kind: kind ?? 'basic',
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
        orientation = suggestOrientation(photo.widthPx, photo.heightPx);
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
      if (s.kind === 'extended') {
        // ADR-025: extended 라인은 방향 스냅샷을 각자 보유 — 전역 방향은 "새 라인
        // 기본값" 컨텍스트만 바꾸고 트레이는 유지한다(활성 크롭만 무효화).
        return { orientation: o, confirmedCrop: null };
      }
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
      if (s.kind === 'extended') {
        // ADR-025: extended 라인은 담기 시점 옵션 스냅샷으로 이미 베이크됨 —
        // 전역 사이즈는 "새 라인 기본값"만 바꾸고 트레이는 유지한다.
        return {
          selectedOptions: { ...s.selectedOptions, sizeCode: code },
          selectedVariantId: variantId,
          confirmedCrop: null,
        };
      }
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
  addEntry: ({ photo, previewUrl, sourcePhotoId, sourcePhotoUrl, cropTransform }) =>
    set((s) => ({
      entries: [
        ...s.entries,
        {
          entryId: crypto.randomUUID(),
          photo,
          previewUrl,
          quantity: 1,
          sourcePhotoId,
          sourcePhotoUrl,
          cropTransform,
          // ADR-025: extended 는 담는 순간의 전역 옵션/방향을 라인 스냅샷으로
          // 동결한다(이후 전역 변경과 무관). basic 라인은 undefined 유지 →
          // 전역 옵션 사용(현행 동작 문자 그대로).
          ...(s.kind === 'extended'
            ? {
                selectedOptions: { ...s.selectedOptions },
                orientation: s.orientation,
              }
            : {}),
        },
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
  clearEntries: () => set({ entries: [], restoredDraftCount: null }),
  addPhotoToPool: (ref) =>
    set((s) => {
      const i = s.photoPool.findIndex((p) => p.photoId === ref.photoId);
      if (i === -1) return { photoPool: [...s.photoPool, ref] };
      // Upsert — 같은 photoId 재추가는 참조 갱신(풀은 photoId-유일).
      const next = s.photoPool.slice();
      next[i] = ref;
      return { photoPool: next };
    }),
  removeFromPool: (photoId) =>
    set((s) => ({
      // 풀에서만 제거 — 이미 만든 라인은 자체 photo/스냅샷을 보유하므로 유지.
      photoPool: s.photoPool.filter((p) => p.photoId !== photoId),
    })),
  updateLineOptions: (entryId, selectedOptions, orientation) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.entryId === entryId
          ? { ...e, selectedOptions: { ...selectedOptions }, orientation }
          : e,
      ),
    })),
  duplicateLine: (entryId) =>
    set((s) => {
      const i = s.entries.findIndex((e) => e.entryId === entryId);
      const src = i === -1 ? undefined : s.entries[i];
      if (!src) return s;
      const copy: EditorPhotoEntry = { ...src, entryId: crypto.randomUUID() };
      return {
        entries: [...s.entries.slice(0, i + 1), copy, ...s.entries.slice(i + 1)],
      };
    }),
  applyOptionsToAllLines: (selectedOptions) =>
    set((s) => ({
      // 옵션만 일괄 교체 — 방향은 라인별 유지(혼합 방향 보존, ADR-025).
      entries: s.entries.map((e) => ({
        ...e,
        selectedOptions: { ...selectedOptions },
      })),
    })),
  restoreDraft: ({ entries, selectedOptions, selectedVariantId, orientation, kind, photoPool }) =>
    set((s) => ({
      entries,
      selectedOptions,
      selectedVariantId,
      orientation,
      // ADR-025(v2): 미지정(레거시 basic 호출부)이면 현재 값 유지 — init 이 이미
      // URL mode 로 kind 를 세팅했고 basic 의 photoPool 은 항상 [].
      kind: kind ?? s.kind,
      photoPool: photoPool ?? s.photoPool,
      restoredDraftCount: entries.length,
      // The restored entries are confirmed baked crops; no active photo in flight.
      photo: null,
      photoId: null,
      confirmedCrop: null,
      cropTransform: initial.cropTransform,
    })),
  reset: (kind) => set({ ...initial, kind: kind ?? 'basic' }),
}));

export function useCurrentVariantPrice(): number {
  return useEditorStore((s) => {
    if (!s.options || !s.selectedVariantId) return 0;
    return s.options.variantsByKey[variantKey(s.selectedOptions)]?.price ?? 0;
  });
}

/**
 * Pure per-line unit price (ADR-025 — 라인별 가격).
 * - extended 라인(`entry.selectedOptions` 있음): 라인 스냅샷으로 variant 를 파생해
 *   그 가격을 쓴다. variant 미존재(비활성화된 조합) = 0 — UI 는
 *   `useLineAvailability` 로 경고를 표시한다.
 * - basic 라인(스냅샷 없음): 현행 전역 단가(= `useCurrentVariantPrice` 와 동일 규칙).
 */
export function lineUnitPrice(
  s: Pick<State, 'options' | 'selectedOptions' | 'selectedVariantId'>,
  entry: Pick<EditorPhotoEntry, 'selectedOptions'>,
): number {
  if (!s.options) return 0;
  if (entry.selectedOptions) {
    return s.options.variantsByKey[variantKey(entry.selectedOptions)]?.price ?? 0;
  }
  if (!s.selectedVariantId) return 0;
  return s.options.variantsByKey[variantKey(s.selectedOptions)]?.price ?? 0;
}

/**
 * Pure availability check (ADR-025): 라인의 유효 옵션(라인 스냅샷 ?? 전역)으로
 * variant 가 실제 존재하는지. false = 비활성화된 조합(가격 0) — UI 경고 대상.
 */
export function isLineVariantAvailable(
  s: Pick<State, 'options' | 'selectedOptions'>,
  entry: Pick<EditorPhotoEntry, 'selectedOptions'>,
): boolean {
  if (!s.options) return false;
  const opts = entry.selectedOptions ?? s.selectedOptions;
  return s.options.variantsByKey[variantKey(opts)] !== undefined;
}

/**
 * 라인 단위 variant 존재 여부 셀렉터(ADR-025) — LineList 항목이 "이 조합은 현재
 * 판매하지 않아요" 경고를 띄우는 용도. boolean 원시값 선택이라 Object.is-stable.
 * 존재하지 않는 entryId 는 true(경고 없음 — 라인이 사라지는 프레임에서 안전).
 */
export function useLineAvailability(entryId: string): boolean {
  return useEditorStore((s) => {
    const entry = s.entries.find((e) => e.entryId === entryId);
    return entry ? isLineVariantAvailable(s, entry) : true;
  });
}

/**
 * Running totals across the tray (+ the active photo if it's already confirmed
 * but not yet pushed). Quantity is the sum of entry quantities; price is
 * `sum(price_i × qty_i)` — ADR-025: 라인 스냅샷이 있으면 라인별 단가, 없으면
 * 전역 단가(basic 은 현행과 동일하게 quantity × 전역 단가로 수렴).
 */
export function useEditorTotals(): { totalQuantity: number; totalPrice: number } {
  // Select PRIMITIVES (sums) so the store comparison stays Object.is-stable;
  // build the result object in the hook body, not the selector.
  const totalQuantity = useEditorStore((s) =>
    s.entries.reduce((sum, e) => sum + e.quantity, 0),
  );
  const totalPrice = useEditorStore((s) =>
    s.entries.reduce((sum, e) => sum + lineUnitPrice(s, e) * e.quantity, 0),
  );
  return { totalQuantity, totalPrice };
}
