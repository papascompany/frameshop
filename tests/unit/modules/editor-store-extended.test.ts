/**
 * Editor store — 확장형 P1 (FS-P1-01, ADR-025).
 *
 * 고정하는 계약:
 *  1) 베이직 회귀 0 — kind:'basic' 에서 setSize/setOrientation 은 현행대로
 *     트레이(entries)를 초기화하고, 라인은 스냅샷 필드 없이(전역 옵션 사용) 담긴다.
 *  2) kind:'extended' — 전역 옵션/방향 변경에도 라인 유지, addEntry 시 전역
 *     옵션/방향을 라인 스냅샷으로 동결, 라인별 totals 합산(sum(price_i × qty_i)),
 *     사진풀(add/remove)·라인 조작(update/duplicate/applyToAll)·드래프트 v2 복원.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  isLineVariantAvailable,
  lineUnitPrice,
  suggestOrientation,
  useEditorStore,
  useEditorTotals,
  useLineAvailability,
} from '@/store/editor';
import { asBrand } from '@/types/common';
import type { PhotoId, ProductId, ProductVariantId } from '@/types/common';
import {
  variantKey,
  type OptionMatrix,
  type ProductVariant,
  type SelectedOptions,
} from '@/types/product';
import type { Photo } from '@/types/photo';
import type { EditorKind } from '@/types/editor';
import type { ProjectPhotoRef } from '@/types/project';

// ---------- Fixtures ----------

const PRODUCT_ID = asBrand<ProductId>('p1');

function makeVariant(sizeCode: string, price: number): ProductVariant {
  return {
    id: asBrand<ProductVariantId>(`v-${sizeCode}-black`),
    productId: PRODUCT_ID,
    sizeCode,
    sizeLabel: sizeCode,
    widthMm: 100,
    heightMm: 150,
    colorCode: 'black',
    matteCode: 'none',
    paperCode: 'glossy',
    price,
    stock: 99,
    isActive: true,
  };
}

const V_4X6 = makeVariant('4x6', 5000);
const V_5X7 = makeVariant('5x7', 9000);

function opts(sizeCode: string): SelectedOptions {
  return { sizeCode, colorCode: 'black', matteCode: 'none', paperCode: 'glossy' };
}

// 'A4' 는 sizes 축에는 있지만 variant 가 없는 "비활성화된 조합"이다.
const MATRIX: OptionMatrix = {
  sizes: [
    { code: '4x6', label: '4x6', widthMm: 102, heightMm: 152 },
    { code: '5x7', label: '5x7', widthMm: 127, heightMm: 178 },
    { code: 'A4', label: 'A4', widthMm: 210, heightMm: 297 },
  ],
  colors: [{ code: 'black', label: '블랙', previewUrl: null }],
  mattes: [{ code: 'none', label: '없음' }],
  papers: [{ code: 'glossy', label: '유광' }],
  variantsByKey: {
    [variantKey(opts('4x6'))]: V_4X6,
    [variantKey(opts('5x7'))]: V_5X7,
  },
};

function makePhoto(id: string, widthPx = 3000, heightPx = 4000): Photo {
  return {
    id: asBrand<PhotoId>(id),
    userId: null,
    sessionId: null,
    originalUrl: `https://x.supabase.co/${id}.jpg`,
    thumbUrl: `https://x.supabase.co/${id}-t.jpg`,
    widthPx,
    heightPx,
    exif: null,
    createdAt: '2026-07-01T00:00:00.000Z' as Photo['createdAt'],
  };
}

function makePoolRef(id: string): ProjectPhotoRef {
  return {
    photoId: asBrand<PhotoId>(id),
    previewUrl: `https://x.supabase.co/${id}-t.jpg`,
  };
}

function initStore(kind?: EditorKind): void {
  useEditorStore.getState().init({
    productId: PRODUCT_ID,
    options: MATRIX,
    defaultVariantId: V_4X6.id,
    ...(kind ? { kind } : {}),
  });
}

/** 활성 사진 없이 트레이에 라인 하나를 담는다(스토어 계약상 photo 선행 불필요). */
function addLine(id: string): string {
  useEditorStore.getState().addEntry({
    photo: makePhoto(`baked-${id}`),
    previewUrl: `blob:${id}`,
  });
  const entries = useEditorStore.getState().entries;
  const last = entries[entries.length - 1];
  if (!last) throw new Error('addEntry did not append');
  return last.entryId;
}

afterEach(() => {
  useEditorStore.getState().reset();
});

// ---------- kind / init / reset ----------

describe('editor kind (ADR-025)', () => {
  it('defaults to basic; init(kind:"extended") switches the session mode', () => {
    initStore();
    expect(useEditorStore.getState().kind).toBe('basic');
    initStore('extended');
    expect(useEditorStore.getState().kind).toBe('extended');
  });

  it('reset() returns to basic (현행 시그니처 무파손); reset("extended") re-arms extended', () => {
    initStore('extended');
    useEditorStore.getState().addPhotoToPool(makePoolRef('pp1'));
    useEditorStore.getState().reset();
    expect(useEditorStore.getState().kind).toBe('basic');
    expect(useEditorStore.getState().photoPool).toEqual([]);
    useEditorStore.getState().reset('extended');
    expect(useEditorStore.getState().kind).toBe('extended');
    expect(useEditorStore.getState().photoPool).toEqual([]);
  });
});

// ---------- basic 회귀 고정 (현행 동작 스냅샷) ----------

describe('basic 회귀 고정', () => {
  it('basic: setSize clears the tray and rolls back on a variant-less size (현행 동작)', () => {
    initStore();
    addLine('a');
    expect(useEditorStore.getState().entries).toHaveLength(1);

    useEditorStore.getState().setSize('5x7');
    const s = useEditorStore.getState();
    expect(s.entries).toHaveLength(0);
    expect(s.selectedOptions.sizeCode).toBe('5x7');
    expect(s.selectedVariantId).toBe(V_5X7.id);

    // variant 가 없는 사이즈(A4)는 롤백 — 상태 무변경(현행 동작).
    addLine('b');
    useEditorStore.getState().setSize('A4');
    const after = useEditorStore.getState();
    expect(after.selectedOptions.sizeCode).toBe('5x7');
    expect(after.entries).toHaveLength(1);
  });

  it('basic: setOrientation clears the tray (현행 동작)', () => {
    initStore();
    addLine('a');
    useEditorStore.getState().setOrientation('landscape');
    const s = useEditorStore.getState();
    expect(s.orientation).toBe('landscape');
    expect(s.entries).toHaveLength(0);
  });

  it('basic: addEntry leaves per-line snapshot fields undefined (전역 옵션 사용)', () => {
    initStore();
    addLine('a');
    const entry = useEditorStore.getState().entries[0];
    expect(entry?.selectedOptions).toBeUndefined();
    expect(entry?.orientation).toBeUndefined();
  });

  it('basic: totals = 전역 단가 × 수량 합 (현행 동작 수렴)', () => {
    initStore();
    const a = addLine('a');
    const b = addLine('b');
    useEditorStore.getState().setEntryQuantity(a, 2);
    useEditorStore.getState().setEntryQuantity(b, 3);
    const { result } = renderHook(() => useEditorTotals());
    expect(result.current.totalQuantity).toBe(5);
    expect(result.current.totalPrice).toBe(5 * 5000); // 전역 4x6 단가
  });
});

// ---------- extended: 라인 유지 + 스냅샷 동결 ----------

describe('extended 라인 유지 (ADR-025)', () => {
  it('extended: setSize preserves the tray and only moves the new-line default', () => {
    initStore('extended');
    addLine('a');
    useEditorStore.getState().setSize('5x7');
    const s = useEditorStore.getState();
    expect(s.entries).toHaveLength(1);
    expect(s.selectedOptions.sizeCode).toBe('5x7');
    expect(s.selectedVariantId).toBe(V_5X7.id);
  });

  it('extended: setOrientation preserves the tray', () => {
    initStore('extended');
    addLine('a');
    useEditorStore.getState().setOrientation('landscape');
    const s = useEditorStore.getState();
    expect(s.orientation).toBe('landscape');
    expect(s.entries).toHaveLength(1);
  });

  it('extended: addEntry freezes the current global options/orientation as the line snapshot', () => {
    initStore('extended');
    useEditorStore.getState().setSize('5x7');
    useEditorStore.getState().setOrientation('landscape');
    addLine('a');

    const frozen = useEditorStore.getState().entries[0];
    expect(frozen?.selectedOptions).toEqual(opts('5x7'));
    expect(frozen?.orientation).toBe('landscape');

    // 이후 전역 변경은 이미 동결된 라인 스냅샷에 영향을 주지 않는다.
    useEditorStore.getState().setSize('4x6');
    useEditorStore.getState().setOrientation('portrait');
    const still = useEditorStore.getState().entries[0];
    expect(still?.selectedOptions?.sizeCode).toBe('5x7');
    expect(still?.orientation).toBe('landscape');
  });
});

// ---------- 라인별 totals 합산 ----------

describe('useEditorTotals — 라인별 합산 (ADR-025)', () => {
  it('혼합 사이즈 케이스 1: sum(price_i × qty_i) — 4x6×1 + 5x7×2', () => {
    initStore('extended');
    addLine('a'); // 스냅샷 4x6 (5000)
    useEditorStore.getState().setSize('5x7');
    const b = addLine('b'); // 스냅샷 5x7 (9000)
    useEditorStore.getState().setEntryQuantity(b, 2);

    const { result } = renderHook(() => useEditorTotals());
    expect(result.current.totalQuantity).toBe(3);
    expect(result.current.totalPrice).toBe(5000 * 1 + 9000 * 2);
  });

  it('혼합 사이즈 케이스 2: 스냅샷 없는 라인은 전역 단가로 폴백해 합산된다', () => {
    initStore('extended');
    // 드래프트 복원 등으로 스냅샷 유무가 섞인 트레이 — 폴백 분기 검증.
    useEditorStore.getState().restoreDraft({
      entries: [
        {
          entryId: 'legacy-line',
          photo: makePhoto('baked-legacy'),
          previewUrl: 'blob:legacy',
          quantity: 2,
          // selectedOptions/orientation 없음 → 전역(4x6, 5000) 폴백.
        },
        {
          entryId: 'snap-line',
          photo: makePhoto('baked-snap'),
          previewUrl: 'blob:snap',
          quantity: 1,
          selectedOptions: opts('5x7'),
          orientation: 'landscape',
        },
      ],
      selectedOptions: opts('4x6'),
      selectedVariantId: V_4X6.id,
      orientation: 'portrait',
      kind: 'extended',
    });

    const { result } = renderHook(() => useEditorTotals());
    expect(result.current.totalQuantity).toBe(3);
    expect(result.current.totalPrice).toBe(5000 * 2 + 9000 * 1);
  });

  it('variant 미존재(비활성 조합) 라인은 가격 0 + availability 셀렉터가 경고를 판별한다', () => {
    initStore('extended');
    const ok = addLine('ok'); // 4x6 (5000)
    const bad = addLine('bad');
    // A4 는 sizes 축에 있으나 variant 가 없다 — updateLineOptions 는 검증하지 않는다.
    useEditorStore.getState().updateLineOptions(bad, opts('A4'), 'portrait');
    useEditorStore.getState().setEntryQuantity(bad, 5);

    const s = useEditorStore.getState();
    const badEntry = s.entries.find((e) => e.entryId === bad);
    const okEntry = s.entries.find((e) => e.entryId === ok);
    expect(badEntry && lineUnitPrice(s, badEntry)).toBe(0);
    expect(okEntry && lineUnitPrice(s, okEntry)).toBe(5000);
    expect(badEntry && isLineVariantAvailable(s, badEntry)).toBe(false);
    expect(okEntry && isLineVariantAvailable(s, okEntry)).toBe(true);

    const totals = renderHook(() => useEditorTotals());
    expect(totals.result.current.totalPrice).toBe(5000); // bad 라인은 0원 기여
    expect(totals.result.current.totalQuantity).toBe(6); // 수량은 그대로 집계

    const badHook = renderHook(() => useLineAvailability(bad));
    expect(badHook.result.current).toBe(false);
    const okHook = renderHook(() => useLineAvailability(ok));
    expect(okHook.result.current).toBe(true);
    // 존재하지 않는 라인은 경고를 띄우지 않는다(true).
    const goneHook = renderHook(() => useLineAvailability('no-such-entry'));
    expect(goneHook.result.current).toBe(true);
  });
});

// ---------- 라인 조작 액션 ----------

describe('line ops (ADR-025)', () => {
  it('updateLineOptions updates only the target line (options + orientation)', () => {
    initStore('extended');
    const a = addLine('a');
    const b = addLine('b');
    useEditorStore.getState().updateLineOptions(b, opts('5x7'), 'landscape');

    const s = useEditorStore.getState();
    const ea = s.entries.find((e) => e.entryId === a);
    const eb = s.entries.find((e) => e.entryId === b);
    expect(eb?.selectedOptions).toEqual(opts('5x7'));
    expect(eb?.orientation).toBe('landscape');
    expect(ea?.selectedOptions).toEqual(opts('4x6')); // 다른 라인 무변경
    expect(ea?.orientation).toBe('portrait');
  });

  it('duplicateLine inserts a copy with a fresh entryId right after the source', () => {
    initStore('extended');
    const a = addLine('a');
    const b = addLine('b');
    useEditorStore.getState().setEntryQuantity(a, 3);
    useEditorStore.getState().duplicateLine(a);

    const s = useEditorStore.getState();
    expect(s.entries).toHaveLength(3);
    expect(s.entries.map((e) => e.entryId)[0]).toBe(a);
    expect(s.entries.map((e) => e.entryId)[2]).toBe(b);
    const copy = s.entries[1];
    expect(copy?.entryId).not.toBe(a);
    expect(copy?.entryId).not.toBe(b);
    expect(copy?.quantity).toBe(3); // 내용 복제
    expect(copy?.selectedOptions).toEqual(opts('4x6'));
    // 존재하지 않는 라인 복제는 no-op.
    useEditorStore.getState().duplicateLine('no-such-entry');
    expect(useEditorStore.getState().entries).toHaveLength(3);
  });

  it('applyOptionsToAllLines applies options to every line but keeps per-line orientation', () => {
    initStore('extended');
    const a = addLine('a'); // portrait
    useEditorStore.getState().setOrientation('landscape');
    const b = addLine('b'); // landscape
    useEditorStore.getState().applyOptionsToAllLines(opts('5x7'));

    const s = useEditorStore.getState();
    const ea = s.entries.find((e) => e.entryId === a);
    const eb = s.entries.find((e) => e.entryId === b);
    expect(ea?.selectedOptions).toEqual(opts('5x7'));
    expect(eb?.selectedOptions).toEqual(opts('5x7'));
    expect(ea?.orientation).toBe('portrait'); // 방향은 라인별 유지
    expect(eb?.orientation).toBe('landscape');
  });
});

// ---------- 사진풀 ----------

describe('photoPool (ADR-025)', () => {
  it('addPhotoToPool appends; re-adding the same photoId upserts without duplication', () => {
    initStore('extended');
    useEditorStore.getState().addPhotoToPool(makePoolRef('ph1'));
    useEditorStore.getState().addPhotoToPool(makePoolRef('ph2'));
    expect(useEditorStore.getState().photoPool).toHaveLength(2);

    useEditorStore
      .getState()
      .addPhotoToPool({ ...makePoolRef('ph1'), previewUrl: 'https://x.supabase.co/ph1-new.jpg' });
    const pool = useEditorStore.getState().photoPool;
    expect(pool).toHaveLength(2); // 중복 없음
    expect(pool[0]?.previewUrl).toBe('https://x.supabase.co/ph1-new.jpg'); // 참조 갱신
  });

  it('removeFromPool removes only the pool ref — lines made from it survive', () => {
    initStore('extended');
    useEditorStore.getState().addPhotoToPool(makePoolRef('ph1'));
    useEditorStore.getState().addPhotoToPool(makePoolRef('ph2'));
    addLine('from-ph1');

    useEditorStore.getState().removeFromPool(asBrand<PhotoId>('ph1'));
    const s = useEditorStore.getState();
    expect(s.photoPool).toHaveLength(1);
    expect(s.photoPool[0]?.photoId).toBe('ph2');
    expect(s.entries).toHaveLength(1); // 이미 만든 라인 유지
  });
});

// ---------- suggestOrientation ----------

describe('suggestOrientation (순수 함수)', () => {
  it('가로가 길면 landscape, 세로가 길면 portrait, 정사각형은 portrait', () => {
    expect(suggestOrientation(4000, 3000)).toBe('landscape');
    expect(suggestOrientation(3000, 4000)).toBe('portrait');
    expect(suggestOrientation(3000, 3000)).toBe('portrait');
    // 1px 경계.
    expect(suggestOrientation(3001, 3000)).toBe('landscape');
    // 유효하지 않은 치수는 안전 폴백(portrait).
    expect(suggestOrientation(Number.NaN, Number.NaN)).toBe('portrait');
  });
});

// ---------- 드래프트 v2 복원 ----------

describe('restoreDraft v2 (ADR-025)', () => {
  it('restores kind/photoPool/per-line options from a v2 draft', () => {
    initStore('extended');
    useEditorStore.getState().restoreDraft({
      entries: [
        {
          entryId: 'line-1',
          photo: makePhoto('baked-1'),
          previewUrl: 'blob:1',
          quantity: 2,
          selectedOptions: opts('5x7'),
          orientation: 'landscape',
        },
      ],
      selectedOptions: opts('4x6'),
      selectedVariantId: V_4X6.id,
      orientation: 'portrait',
      kind: 'extended',
      photoPool: [makePoolRef('ph1'), makePoolRef('ph2')],
    });

    const s = useEditorStore.getState();
    expect(s.kind).toBe('extended');
    expect(s.photoPool).toHaveLength(2);
    expect(s.entries[0]?.selectedOptions).toEqual(opts('5x7'));
    expect(s.entries[0]?.orientation).toBe('landscape');
    expect(s.restoredDraftCount).toBe(1);
    // 복원 직후 활성 사진은 비어 있다(기존 계약 유지).
    expect(s.photo).toBeNull();
    expect(s.confirmedCrop).toBeNull();
  });

  it('legacy call (kind/photoPool 미지정) keeps the current mode and pool — 기존 호출부 무파손', () => {
    initStore('extended');
    useEditorStore.getState().addPhotoToPool(makePoolRef('ph1'));
    useEditorStore.getState().restoreDraft({
      entries: [
        {
          entryId: 'line-1',
          photo: makePhoto('baked-1'),
          previewUrl: 'blob:1',
          quantity: 1,
        },
      ],
      selectedOptions: opts('4x6'),
      selectedVariantId: V_4X6.id,
      orientation: 'portrait',
    });

    const s = useEditorStore.getState();
    expect(s.kind).toBe('extended'); // init 이 세팅한 모드 유지
    expect(s.photoPool).toHaveLength(1); // 풀 유지
    expect(s.restoredDraftCount).toBe(1);
  });
});
