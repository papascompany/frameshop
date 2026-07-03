/**
 * <StudioClient> draft persistence × deep-link preselect (P1-001 / ADR-022).
 *
 * Final review P1-001: entering the studio via a /wall deep link applies the
 * preselect and SKIPS the draft restore — but the debounced persist effect
 * used to fire ~300ms later with an empty tray, and saveEditorDraft deletes
 * the stored draft on empty entries. The fix suppresses persistence until the
 * user actually edits. These tests pin:
 *
 *  1. preselect entry + NO edit  → the existing draft survives (ADR-022)
 *  2. preselect entry + real edit → persistence resumes, new draft saved
 *  3. option change is a real edit → persistence resumes (normal semantics)
 *  4. legacy path (no preselect)  → draft restore + persist unchanged
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioClient } from '@/app/(shop)/studio/[orderId]/StudioClient';
import { useEditorStore } from '@/store/editor';
import { loadEditorDraft, saveEditorDraft } from '@/lib/editor/draft';
import { asBrand } from '@/types/common';
import type {
  CategoryId,
  PhotoId,
  ProductId,
  ProductVariantId,
} from '@/types/common';
import {
  variantKey,
  type OptionMatrix,
  type ProductDetail,
  type ProductVariant,
  type SelectedOptions,
} from '@/types/product';
import type { EditorPhotoEntry } from '@/types/editor';
import type { Photo } from '@/types/photo';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const SESSION = 'sess-1';
const PRODUCT_ID = 'p1';

const DRAFT_OPTIONS: SelectedOptions = {
  sizeCode: '4x6',
  colorCode: 'black',
  matteCode: 'none',
  paperCode: 'glossy',
};

function variant(sizeCode: string, colorCode: string): ProductVariant {
  return {
    id: asBrand<ProductVariantId>(`v-${sizeCode}-${colorCode}`),
    productId: asBrand<ProductId>(PRODUCT_ID),
    sizeCode,
    sizeLabel: sizeCode,
    widthMm: 102,
    heightMm: 152,
    colorCode,
    matteCode: 'none',
    paperCode: 'glossy',
    price: 19000,
    stock: 10,
    isActive: true,
  };
}

function matrix(): OptionMatrix {
  const variants = [
    variant('4x6', 'black'),
    variant('4x6', 'white'),
    variant('A4', 'black'),
  ];
  const variantsByKey: Record<string, ProductVariant> = {};
  for (const v of variants) {
    variantsByKey[
      variantKey({
        sizeCode: v.sizeCode,
        colorCode: v.colorCode,
        matteCode: v.matteCode,
        paperCode: v.paperCode,
      })
    ] = v;
  }
  return {
    sizes: [
      { code: '4x6', label: '4×6', widthMm: 102, heightMm: 152 },
      { code: 'A4', label: 'A4', widthMm: 210, heightMm: 297 },
    ],
    colors: [
      { code: 'black', label: '블랙', previewUrl: null },
      { code: 'white', label: '화이트', previewUrl: null },
    ],
    mattes: [{ code: 'none', label: '없음' }],
    papers: [{ code: 'glossy', label: '유광' }],
    variantsByKey,
  };
}

function productDetail(): ProductDetail {
  return {
    product: {
      id: asBrand<ProductId>(PRODUCT_ID),
      categoryId: asBrand<CategoryId>('c1'),
      name: '테스트 액자',
      tagline: '',
      description: '',
      basePrice: 19000,
      hasFrame: true,
      isActive: true,
      sortOrder: 0,
      bleedMm: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    images: { thumbnail: [], gallery: [], guide: [] },
    frames: [],
    defaultVariantId: asBrand<ProductVariantId>('v-4x6-black'),
    startingPrice: 19000,
  };
}

function makePhoto(id: string): Photo {
  return {
    id: asBrand<PhotoId>(id),
    userId: null,
    sessionId: null,
    originalUrl: `https://x.supabase.co/${id}.jpg`,
    thumbUrl: `https://x.supabase.co/${id}-t.jpg`,
    widthPx: 100,
    heightPx: 100,
    exif: null,
    createdAt: '2026-01-01T00:00:00.000Z' as Photo['createdAt'],
  };
}

function makeEntry(id: string): EditorPhotoEntry {
  return {
    entryId: id,
    photo: makePhoto(`photo-${id}`),
    previewUrl: `https://x.supabase.co/${id}-t.jpg`,
    quantity: 1,
    sourcePhotoId: asBrand<PhotoId>(`src-${id}`),
    sourcePhotoUrl: `https://x.supabase.co/src-${id}.jpg`,
    cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
  };
}

/** Seed a pre-existing draft for (SESSION, PRODUCT_ID) — the ADR-022 asset. */
function seedExistingDraft(): void {
  saveEditorDraft(SESSION, PRODUCT_ID, {
    selectedOptions: DRAFT_OPTIONS,
    selectedVariantId: 'v-4x6-black',
    orientation: 'portrait',
    entries: [makeEntry('old')],
  });
  expect(loadEditorDraft(SESSION, PRODUCT_ID)).not.toBeNull();
}

function renderStudio(preselect: { sizeCode?: string; colorCode?: string; orientation?: 'portrait' | 'landscape' } | null) {
  return render(
    <StudioClient
      sessionId={SESSION}
      productDetail={productDetail()}
      options={matrix()}
      preselect={preselect}
    />,
  );
}

/** Run past the 300ms persist debounce. */
function flushPersistDebounce(): void {
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  useEditorStore.getState().reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('StudioClient — deep-link preselect vs saved draft (P1-001)', () => {
  it('프리셀렉트 진입 후 무편집 → 기존 드래프트가 debounce 이후에도 보존된다', () => {
    seedExistingDraft();

    renderStudio({ sizeCode: 'A4', orientation: 'landscape' });

    // Preselect applied (draft restore skipped) — tray must stay empty.
    expect(useEditorStore.getState().entries).toHaveLength(0);
    expect(useEditorStore.getState().selectedOptions.sizeCode).toBe('A4');

    // The old bug: the empty-tray persist fired here and DELETED the draft.
    flushPersistDebounce();
    const draft = loadEditorDraft(SESSION, PRODUCT_ID);
    expect(draft).not.toBeNull();
    expect(draft?.entries[0]?.entryId).toBe('old');
    expect(draft?.selectedOptions.sizeCode).toBe('4x6');

    // Still intact across further no-edit debounce windows.
    flushPersistDebounce();
    expect(loadEditorDraft(SESSION, PRODUCT_ID)).not.toBeNull();
  });

  it('프리셀렉트 진입 후 실제 편집(트레이 담기) → persist가 재개되어 새 드래프트가 저장된다', () => {
    seedExistingDraft();

    renderStudio({ sizeCode: 'A4', orientation: 'landscape' });
    flushPersistDebounce(); // no-edit window: old draft untouched
    expect(loadEditorDraft(SESSION, PRODUCT_ID)?.entries[0]?.entryId).toBe('old');

    // Real edit: a confirmed photo lands in the tray (담기).
    act(() => {
      useEditorStore.getState().addEntry({
        photo: makePhoto('photo-new'),
        previewUrl: 'https://x.supabase.co/photo-new-t.jpg',
      });
    });
    flushPersistDebounce();

    const draft = loadEditorDraft(SESSION, PRODUCT_ID);
    expect(draft).not.toBeNull();
    expect(draft?.entries).toHaveLength(1);
    expect(draft?.entries[0]?.photo.id).toBe('photo-new');
    // The new draft reflects the deep-linked session options.
    expect(draft?.selectedOptions.sizeCode).toBe('A4');
    expect(draft?.orientation).toBe('landscape');
  });

  it('프리셀렉트 진입 후 옵션 변경도 실제 편집 → persist 재개(빈 트레이 = 기존 semantics대로 드래프트 대체/삭제)', () => {
    seedExistingDraft();

    renderStudio({ sizeCode: 'A4', orientation: 'landscape' });
    flushPersistDebounce();
    expect(loadEditorDraft(SESSION, PRODUCT_ID)).not.toBeNull();

    // User picks a colour — deviates from the injected baseline.
    act(() => {
      useEditorStore.getState().setSize('4x6');
    });
    act(() => {
      useEditorStore.getState().setColor('white');
    });
    flushPersistDebounce();

    // Persistence resumed: empty tray + edited options → draft cleared,
    // exactly what a plain (non-deep-link) session would do.
    expect(loadEditorDraft(SESSION, PRODUCT_ID)).toBeNull();
  });

  it('회귀: 파라미터 없는 기존 경로는 드래프트를 복원하고 그대로 유지한다', () => {
    seedExistingDraft();

    renderStudio(null);

    // Legacy restore path: tray rehydrated + one-time notice.
    expect(useEditorStore.getState().entries).toHaveLength(1);
    expect(useEditorStore.getState().restoredDraftCount).toBe(1);
    expect(screen.getByText(/이전에 작업하던 사진/)).toBeInTheDocument();

    // Persist keeps the restored draft round-tripping.
    flushPersistDebounce();
    const draft = loadEditorDraft(SESSION, PRODUCT_ID);
    expect(draft).not.toBeNull();
    expect(draft?.entries[0]?.entryId).toBe('old');
    expect(draft?.selectedOptions.colorCode).toBe('black');
  });
});
