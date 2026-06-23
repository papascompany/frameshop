/**
 * Editor draft persistence (선결과제 3) unit tests.
 *
 * Verifies session-scoped localStorage drafts round-trip, are isolated by
 * (sessionId, productId), expire by TTL, and discard corrupt/foreign data —
 * the integrity guarantees behind "작업 손실 없는 새로고침 복원".
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EDITOR_DRAFT_TTL_MS,
  clearEditorDraft,
  editorDraftKey,
  loadEditorDraft,
  saveEditorDraft,
} from '@/lib/editor/draft';
import { asBrand } from '@/types/common';
import type { PhotoId } from '@/types/common';
import type { EditorPhotoEntry } from '@/types/editor';
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
