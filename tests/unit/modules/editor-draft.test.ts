/**
 * Editor draft persistence (선결과제 3) unit tests.
 *
 * Verifies session-scoped localStorage drafts round-trip, are isolated by
 * (sessionId, productId), expire by TTL, and discard corrupt/foreign data —
 * the integrity guarantees behind "작업 손실 없는 새로고침 복원".
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EDITOR_DRAFT_KEY_PREFIX,
  EDITOR_DRAFT_TTL_MS,
  clearEditorDraft,
  editorDraftKey,
  loadEditorDraft,
  migrateEditorDraftV1,
  saveEditorDraft,
} from '@/lib/editor/draft';
import type { EditorDraftV1 } from '@/lib/editor/draft';
import { asBrand } from '@/types/common';
import type { PhotoId } from '@/types/common';
import type { EditorPhotoEntry } from '@/types/editor';
import type { ProjectPhotoRef } from '@/types/project';
import type { SelectedOptions } from '@/types/product';
import type { Photo } from '@/types/photo';

const SESSION = 'sess-abc';
const PRODUCT = 'prod-1';
const OPTIONS: SelectedOptions = {
  sizeCode: 'A4',
  colorCode: 'BLACK',
  matteCode: 'none',
  paperCode: 'glossy',
};

function makePhoto(id = 'photo-1'): Photo {
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

function makeEntry(id = 'e1'): EditorPhotoEntry {
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

function snapshot(entries: EditorPhotoEntry[]) {
  return {
    selectedOptions: OPTIONS,
    selectedVariantId: 'variant-1',
    orientation: 'landscape' as const,
    entries,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('editor draft persistence (선결과제 3)', () => {
  it('round-trips a saved session (entries + options + orientation)', () => {
    saveEditorDraft(SESSION, PRODUCT, snapshot([makeEntry('a'), makeEntry('b')]));
    const draft = loadEditorDraft(SESSION, PRODUCT);
    expect(draft).not.toBeNull();
    expect(draft?.entries).toHaveLength(2);
    expect(draft?.orientation).toBe('landscape');
    expect(draft?.selectedOptions.sizeCode).toBe('A4');
    expect(draft?.selectedVariantId).toBe('variant-1');
    // Source provenance from prereq 1 survives the round-trip.
    expect(draft?.entries[0]?.sourcePhotoId).toBe('src-a');
  });

  it('saving an empty tray clears the draft', () => {
    saveEditorDraft(SESSION, PRODUCT, snapshot([makeEntry('a')]));
    expect(loadEditorDraft(SESSION, PRODUCT)).not.toBeNull();
    saveEditorDraft(SESSION, PRODUCT, snapshot([]));
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
  });

  it('clearEditorDraft removes the draft', () => {
    saveEditorDraft(SESSION, PRODUCT, snapshot([makeEntry('a')]));
    clearEditorDraft(SESSION, PRODUCT);
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
  });

  it('isolates drafts by sessionId and productId', () => {
    saveEditorDraft(SESSION, PRODUCT, snapshot([makeEntry('a')]));
    // Different session → not visible (photo-ownership boundary).
    expect(loadEditorDraft('other-sess', PRODUCT)).toBeNull();
    // Different product → not visible.
    expect(loadEditorDraft(SESSION, 'prod-2')).toBeNull();
  });

  it('discards a draft whose productId does not match the request', () => {
    // Hand-craft a draft stored under PRODUCT but tagged with a different productId.
    const key = editorDraftKey(SESSION, PRODUCT);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        productId: 'SOMETHING-ELSE',
        selectedOptions: OPTIONS,
        selectedVariantId: null,
        orientation: 'portrait',
        entries: [makeEntry('a')],
      }),
    );
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
    // Invalid draft is purged.
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('expires drafts older than the TTL', () => {
    const key = editorDraftKey(SESSION, PRODUCT);
    const stale = new Date(Date.now() - EDITOR_DRAFT_TTL_MS - 1000).toISOString();
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        savedAt: stale,
        productId: PRODUCT,
        selectedOptions: OPTIONS,
        selectedVariantId: null,
        orientation: 'portrait',
        entries: [makeEntry('a')],
      }),
    );
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('discards corrupt JSON', () => {
    const key = editorDraftKey(SESSION, PRODUCT);
    window.localStorage.setItem(key, '{not valid json');
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('discards a draft with a mismatched version', () => {
    const key = editorDraftKey(SESSION, PRODUCT);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 99,
        savedAt: new Date().toISOString(),
        productId: PRODUCT,
        selectedOptions: OPTIONS,
        selectedVariantId: null,
        orientation: 'portrait',
        entries: [makeEntry('a')],
      }),
    );
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
  });
});

// ---------- 드래프트 v2 (ADR-025 — 확장형 P1) ----------

const OPTIONS_B: SelectedOptions = {
  sizeCode: 'A3',
  colorCode: 'WALNUT',
  matteCode: 'none',
  paperCode: 'glossy',
};

function makePoolRef(id = 'p1'): ProjectPhotoRef {
  return {
    photoId: asBrand<PhotoId>(`pool-${id}`),
    sourcePhotoId: asBrand<PhotoId>(`src-pool-${id}`),
    previewUrl: `https://x.supabase.co/pool-${id}-t.jpg`,
  };
}

function makeExtendedEntry(id: string): EditorPhotoEntry {
  return {
    ...makeEntry(id),
    selectedOptions: OPTIONS_B,
    orientation: 'landscape',
  };
}

describe('editor draft v2 (ADR-025)', () => {
  it('keeps the legacy v1 string baked into the storage key (no key bump)', () => {
    // 키를 v2 로 바꾸면 기존 드래프트가 전부 고아가 된다 — 계약으로 고정.
    expect(EDITOR_DRAFT_KEY_PREFIX).toBe('frameshop.editor.draft.v1');
  });

  it('migrateEditorDraftV1 promotes v1 → v2 with zero loss (kind basic, no photoPool)', () => {
    const v1: EditorDraftV1 = {
      version: 1,
      savedAt: '2026-07-01T00:00:00.000Z',
      productId: PRODUCT,
      selectedOptions: OPTIONS,
      selectedVariantId: 'variant-1',
      orientation: 'landscape',
      entries: [makeEntry('a'), makeEntry('b')],
    };
    const v2 = migrateEditorDraftV1(v1);
    expect(v2.version).toBe(2);
    expect(v2.kind).toBe('basic');
    expect(v2.photoPool).toBeUndefined();
    // 손실 0 — 모든 v1 필드가 그대로 보존된다.
    expect(v2.savedAt).toBe(v1.savedAt);
    expect(v2.productId).toBe(v1.productId);
    expect(v2.selectedOptions).toEqual(v1.selectedOptions);
    expect(v2.selectedVariantId).toBe('variant-1');
    expect(v2.orientation).toBe('landscape');
    expect(v2.entries).toEqual(v1.entries);
  });

  it('loads a stored v1 payload as an auto-promoted v2 draft (zero loss)', () => {
    const key = editorDraftKey(SESSION, PRODUCT);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        productId: PRODUCT,
        selectedOptions: OPTIONS,
        selectedVariantId: 'variant-1',
        orientation: 'portrait',
        entries: [makeEntry('a')],
      }),
    );
    const draft = loadEditorDraft(SESSION, PRODUCT);
    expect(draft).not.toBeNull();
    expect(draft?.version).toBe(2);
    expect(draft?.kind).toBe('basic');
    expect(draft?.photoPool).toBeUndefined();
    expect(draft?.entries).toHaveLength(1);
    expect(draft?.entries[0]?.sourcePhotoId).toBe('src-a');
    expect(draft?.selectedOptions.sizeCode).toBe('A4');
    expect(draft?.selectedVariantId).toBe('variant-1');
    expect(draft?.orientation).toBe('portrait');
  });

  it('round-trips an extended v2 draft (kind + photoPool + per-line options/orientation)', () => {
    saveEditorDraft(SESSION, PRODUCT, {
      kind: 'extended',
      selectedOptions: OPTIONS,
      selectedVariantId: 'variant-1',
      orientation: 'portrait',
      photoPool: [makePoolRef('1'), makePoolRef('2')],
      entries: [makeExtendedEntry('a'), makeEntry('b')],
    });
    const draft = loadEditorDraft(SESSION, PRODUCT);
    expect(draft?.version).toBe(2);
    expect(draft?.kind).toBe('extended');
    expect(draft?.photoPool).toHaveLength(2);
    expect(draft?.photoPool?.[0]?.photoId).toBe('pool-1');
    // 라인 단위 옵션 스냅샷 보존(extended 라인) + basic 라인은 undefined 유지.
    expect(draft?.entries[0]?.selectedOptions?.sizeCode).toBe('A3');
    expect(draft?.entries[0]?.orientation).toBe('landscape');
    expect(draft?.entries[1]?.selectedOptions).toBeUndefined();
    expect(draft?.entries[1]?.orientation).toBeUndefined();
  });

  it('defaults kind to basic when the legacy snapshot shape omits it', () => {
    // 기존 호출부(StudioClient 단품 경로) 시그니처 무파손 계약.
    saveEditorDraft(SESSION, PRODUCT, snapshot([makeEntry('a')]));
    const draft = loadEditorDraft(SESSION, PRODUCT);
    expect(draft?.version).toBe(2);
    expect(draft?.kind).toBe('basic');
  });

  it('persists a pool-only extended session (entries empty) and clears only when both are empty', () => {
    // 확장형: 라인 확정 전 사진풀만 채운 상태도 복원 가치가 있다(ADR-025).
    saveEditorDraft(SESSION, PRODUCT, {
      kind: 'extended',
      selectedOptions: OPTIONS,
      selectedVariantId: null,
      orientation: 'portrait',
      photoPool: [makePoolRef('1')],
      entries: [],
    });
    expect(loadEditorDraft(SESSION, PRODUCT)?.photoPool).toHaveLength(1);
    // entries 도 photoPool 도 비면 드래프트 삭제.
    saveEditorDraft(SESSION, PRODUCT, {
      kind: 'extended',
      selectedOptions: OPTIONS,
      selectedVariantId: null,
      orientation: 'portrait',
      photoPool: [],
      entries: [],
    });
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
  });

  it('discards a corrupt v2 draft with an unknown kind (purged)', () => {
    const key = editorDraftKey(SESSION, PRODUCT);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        productId: PRODUCT,
        kind: 'mystery',
        selectedOptions: OPTIONS,
        selectedVariantId: null,
        orientation: 'portrait',
        entries: [makeEntry('a')],
      }),
    );
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('discards a corrupt v2 draft whose photoPool is not a valid array', () => {
    const key = editorDraftKey(SESSION, PRODUCT);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        productId: PRODUCT,
        kind: 'extended',
        selectedOptions: OPTIONS,
        selectedVariantId: null,
        orientation: 'portrait',
        photoPool: 'not-an-array',
        entries: [makeEntry('a')],
      }),
    );
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('drops only photoPool items whose URLs are not https:// (심층방어 — 드래프트 전체는 유지)', () => {
    // FS-P1-security P2-004: 변조 드래프트의 previewUrl/originalUrl 이 <img src>
    // 로 직행하는 경로의 심층방어. 불일치 항목만 드랍, 전체 폐기 아님.
    const key = editorDraftKey(SESSION, PRODUCT);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        productId: PRODUCT,
        kind: 'extended',
        selectedOptions: OPTIONS,
        selectedVariantId: null,
        orientation: 'portrait',
        photoPool: [
          makePoolRef('ok'),
          { photoId: 'evil-1', previewUrl: 'javascript:alert(1)' },
          {
            photoId: 'evil-2',
            previewUrl: 'https://x.supabase.co/e-t.jpg',
            originalUrl: 'http://evil.example/e.jpg',
          },
        ],
        entries: [makeEntry('a')],
      }),
    );
    const draft = loadEditorDraft(SESSION, PRODUCT);
    expect(draft).not.toBeNull();
    expect(draft?.photoPool).toHaveLength(1);
    expect(draft?.photoPool?.[0]?.photoId).toBe('pool-ok');
    // 항목 드랍이 전체 폐기가 아니다 — entries/저장본은 그대로 산다.
    expect(draft?.entries).toHaveLength(1);
    expect(window.localStorage.getItem(key)).not.toBeNull();
  });

  it('discards a v2 draft whose entry carries an invalid per-line orientation', () => {
    const key = editorDraftKey(SESSION, PRODUCT);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        productId: PRODUCT,
        kind: 'extended',
        selectedOptions: OPTIONS,
        selectedVariantId: null,
        orientation: 'portrait',
        entries: [{ ...makeEntry('a'), orientation: 'diagonal' }],
      }),
    );
    expect(loadEditorDraft(SESSION, PRODUCT)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
