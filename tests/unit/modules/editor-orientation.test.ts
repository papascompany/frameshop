/**
 * Editor store — 가로/세로(orientation) behavior.
 *
 * Spec ties to Excel requirement #2: 가로 사진 → 가로 틀, 세로 사진 → 세로 틀
 * (auto-match on load), plus an explicit 방향 toggle that re-bakes the crop.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '@/store/editor';
import type { Photo } from '@/types/photo';
import type { PhotoId } from '@/types/common';

function makePhoto(widthPx: number | null, heightPx: number | null, id = 'p1'): Photo {
  return {
    id: id as PhotoId,
    userId: null,
    sessionId: null,
    originalUrl: 'https://example.com/o.jpg',
    thumbUrl: 'https://example.com/t.jpg',
    widthPx,
    heightPx,
    exif: null,
    createdAt: '2026-06-13T00:00:00.000Z',
  };
}

afterEach(() => {
  useEditorStore.getState().reset();
});

describe('orientation auto-match (setPhoto)', () => {
  it('landscape photo → landscape frame when tray is empty', () => {
    useEditorStore.getState().setPhoto(makePhoto(4000, 3000));
    expect(useEditorStore.getState().orientation).toBe('landscape');
  });

  it('portrait photo → portrait frame when tray is empty', () => {
    useEditorStore.getState().setPhoto(makePhoto(3000, 4000));
    expect(useEditorStore.getState().orientation).toBe('portrait');
  });

  it('square photo defaults to portrait', () => {
    useEditorStore.getState().setPhoto(makePhoto(3000, 3000));
    expect(useEditorStore.getState().orientation).toBe('portrait');
  });

  it('missing dimensions keep the current orientation', () => {
    useEditorStore.getState().setOrientation('landscape');
    useEditorStore.getState().setPhoto(makePhoto(null, null));
    expect(useEditorStore.getState().orientation).toBe('landscape');
  });

  it('does not override orientation once the tray has entries', () => {
    const s = useEditorStore.getState();
    s.setOrientation('portrait');
    s.addEntry({ photo: makePhoto(3000, 4000, 'e1'), previewUrl: 'blob:1' });
    // A landscape photo would normally flip to landscape, but the tray locks it.
    s.setPhoto(makePhoto(4000, 3000, 'p2'));
    expect(useEditorStore.getState().orientation).toBe('portrait');
  });
});

describe('setOrientation', () => {
  it('clears the tray and active confirmed crop on a real change', () => {
    const s = useEditorStore.getState();
    s.setOrientation('portrait');
    s.addEntry({ photo: makePhoto(3000, 4000, 'e1'), previewUrl: 'blob:1' });
    s.setConfirmedCrop(makePhoto(3000, 4000, 'c1'));
    expect(useEditorStore.getState().entries).toHaveLength(1);

    s.setOrientation('landscape');
    const next = useEditorStore.getState();
    expect(next.orientation).toBe('landscape');
    expect(next.entries).toHaveLength(0);
    expect(next.confirmedCrop).toBeNull();
  });

  it('is a no-op (keeps the tray) when the value is unchanged', () => {
    const s = useEditorStore.getState();
    s.setOrientation('landscape');
    s.addEntry({ photo: makePhoto(4000, 3000, 'e1'), previewUrl: 'blob:1' });
    s.setOrientation('landscape');
    expect(useEditorStore.getState().entries).toHaveLength(1);
  });
});
