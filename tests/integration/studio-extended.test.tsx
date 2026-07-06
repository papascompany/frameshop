/**
 * <StudioClient> 확장형(멀티포토) 편집기 — FS-P1-03 (ADR-025).
 *
 * 고정하는 계약:
 *  1. mode 미지정(basic) = 현행과 완전 동일 — PhotoPoolPanel/LineList 미렌더,
 *     기존 트레이 렌더(베이직 회귀 0).
 *  2. kind:'extended' — 사진 보관함 렌더 + 라인별 옵션 변경 시 소계/합계 갱신.
 *  3. 묶음 담기 — 라인 N개가 같은 projectId(1회 생성)를 공유하고 projectSeq/
 *     orientation/라인별 variant·price 로 addToCart 된다(FS-P1-02 계약).
 *  4. 드래프트 v2 — kind/photoPool 이 저장 스냅샷에 포함된다.
 *  5. 프리셀렉트 × mode=multi 공존 — 프리셀렉트 적용 + 기존 드래프트 보존(P1-001).
 *  6. 충돌 시 URL 모드 우선 — basic 드래프트 + multi 진입은 entries 복원 +
 *     kind 'extended'; extended 드래프트 + basic 진입은 복원 스킵 + 드래프트 보존.
 *  7. 풀에서 제거해도 이미 만든 라인은 유지된다.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioClient } from '@/app/(shop)/studio/[orderId]/StudioClient';
import { useEditorStore } from '@/store/editor';
import { loadEditorDraft, saveEditorDraft } from '@/lib/editor/draft';
import koMessages from '@/messages/ko.json';
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
import type { EditorKind, EditorPhotoEntry } from '@/types/editor';
import type { Photo } from '@/types/photo';
import type { ProjectPhotoRef } from '@/types/project';

const { pushMock, addToCartMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  addToCartMock: vi.fn(async (input: unknown) => input),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/cart/client', () => ({
  addToCart: addToCartMock,
}));

// FrameCanvas(konva) 는 jsdom 에서 로드하지 않는다 — 이 파일의 계약은 캔버스 밖
// (풀/라인/담기 가드)이고, 429 업로드 테스트가 사진을 캔버스에 활성화하므로
// dynamic import 대상 모듈을 null 렌더 스텁으로 대체한다.
vi.mock('@/app/(shop)/studio/[orderId]/FrameCanvas', () => ({
  default: () => null,
}));

// 순차 업로드 테스트용 — jsdom 은 캔버스 리사이즈 불가라 패스스루로 대체.
vi.mock('@/lib/image/resize-client', () => ({
  ImageResizeError: class ImageResizeError extends Error {},
  resizeImageToMax: vi.fn(async (file: File) => file),
}));

const SESSION = 'sess-ext-1';
const PRODUCT_ID = 'p1';

const DRAFT_OPTIONS: SelectedOptions = {
  sizeCode: '4x6',
  colorCode: 'black',
  matteCode: 'none',
  paperCode: 'glossy',
};

function variant(sizeCode: string, price: number): ProductVariant {
  return {
    id: asBrand<ProductVariantId>(`v-${sizeCode}-black`),
    productId: asBrand<ProductId>(PRODUCT_ID),
    sizeCode,
    sizeLabel: sizeCode,
    widthMm: 102,
    heightMm: 152,
    colorCode: 'black',
    matteCode: 'none',
    paperCode: 'glossy',
    price,
    stock: 10,
    isActive: true,
  };
}

function matrix(): OptionMatrix {
  const variants = [variant('4x6', 5000), variant('5x7', 9000)];
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
      { code: '5x7', label: '5×7', widthMm: 127, heightMm: 178 },
    ],
    colors: [{ code: 'black', label: '블랙', previewUrl: null }],
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
      basePrice: 5000,
      hasFrame: true,
      isActive: true,
      sortOrder: 0,
      bleedMm: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    images: { thumbnail: [], gallery: [], guide: [] },
    frames: [],
    defaultVariantId: asBrand<ProductVariantId>('v-4x6-black'),
    startingPrice: 5000,
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

function makePoolRef(id: string): ProjectPhotoRef {
  return {
    photoId: asBrand<PhotoId>(id),
    previewUrl: `https://x.supabase.co/${id}-t.jpg`,
    originalUrl: `https://x.supabase.co/${id}.jpg`,
  };
}

function renderStudio(
  kind?: EditorKind,
  preselect: { sizeCode?: string; colorCode?: string; orientation?: 'portrait' | 'landscape' } | null = null,
) {
  return render(
    <NextIntlClientProvider locale="ko" messages={koMessages}>
      <StudioClient
        sessionId={SESSION}
        productDetail={productDetail()}
        options={matrix()}
        preselect={preselect}
        kind={kind}
      />
    </NextIntlClientProvider>,
  );
}

/** Run past the 300ms persist debounce. */
function flushPersistDebounce(): void {
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

/** 확장형 세션에 라인을 심는다(담기 시점 전역 옵션이 라인 스냅샷으로 동결됨). */
function seedExtendedEntry(id: string): void {
  act(() => {
    useEditorStore.getState().addEntry({
      photo: makePhoto(`photo-${id}`),
      previewUrl: `https://x.supabase.co/${id}-t.jpg`,
      sourcePhotoId: asBrand<PhotoId>(`src-${id}`),
      sourcePhotoUrl: `https://x.supabase.co/src-${id}.jpg`,
      cropTransform: { x: 1, y: 2, scale: 1, rotation: 0 },
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  useEditorStore.getState().reset();
  pushMock.mockClear();
  addToCartMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('StudioClient — 확장형(멀티포토) 편집기 (FS-P1-03, ADR-025)', () => {
  it('회귀: mode 미지정(basic) — PhotoPoolPanel/LineList 미렌더, 기존 트레이 렌더', () => {
    // 기존 드래프트가 있는 현행 경로 그대로 복원되는지까지 고정.
    saveEditorDraft(SESSION, PRODUCT_ID, {
      selectedOptions: DRAFT_OPTIONS,
      selectedVariantId: 'v-4x6-black',
      orientation: 'portrait',
      entries: [makeEntry('old')],
    });

    renderStudio(undefined);

    expect(useEditorStore.getState().kind).toBe('basic');
    expect(useEditorStore.getState().entries).toHaveLength(1);
    // 확장형 UI 부재(회귀 0).
    expect(screen.queryByTestId('photo-pool-panel')).toBeNull();
    expect(screen.queryByTestId('line-list')).toBeNull();
    expect(screen.queryAllByTestId('multi-checkout')).toHaveLength(0);
    // 기존 트레이 렌더.
    expect(screen.getByText(/담은 사진/)).toBeInTheDocument();
  });

  it('mode=multi — kind extended + 사진 보관함 렌더, 라인 생기면 LineList 렌더', () => {
    renderStudio('extended');

    expect(useEditorStore.getState().kind).toBe('extended');
    expect(screen.getByTestId('photo-pool-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('line-list')).toBeNull();

    seedExtendedEntry('a');

    expect(screen.getByTestId('line-list')).toBeInTheDocument();
    expect(screen.getAllByTestId('line-card')).toHaveLength(1);
    // extended 는 기존 basic 트레이 헤더를 렌더하지 않는다.
    expect(screen.queryByText(/담은 사진/)).toBeNull();
  });

  it('라인 옵션(사이즈) 변경 시 라인 소계와 합계가 갱신된다', () => {
    renderStudio('extended');
    seedExtendedEntry('a'); // 4x6 스냅샷 — 5,000원
    seedExtendedEntry('b'); // 4x6 스냅샷 — 5,000원

    const subtotals = screen.getAllByTestId('line-subtotal');
    expect(subtotals[0]?.textContent).toBe('5,000원');

    // 첫 라인만 5x7 로 — 라인 스냅샷 독립 변경(전역/다른 라인 무접촉).
    const sizeSelects = screen.getAllByTestId('line-size-select');
    fireEvent.change(sizeSelects[0] as HTMLSelectElement, { target: { value: '5x7' } });

    expect(screen.getAllByTestId('line-subtotal')[0]?.textContent).toBe('9,000원');
    expect(screen.getAllByTestId('line-subtotal')[1]?.textContent).toBe('5,000원');
    // 합계(9,000 + 5,000 = 14,000)가 렌더에 반영(데스크톱 레일 + 모바일 스티키).
    expect(screen.getAllByText('14,000').length).toBeGreaterThan(0);
    // 사이즈가 바뀐 라인에는 재편집 권장 배지.
    expect(screen.getAllByTestId('recrop-badge')).toHaveLength(1);
  });

  it('묶음 담기 — 라인별 variant/가격/방향 + 공유 projectId/projectSeq 로 addToCart', async () => {
    renderStudio('extended');
    seedExtendedEntry('a'); // 스냅샷: 4x6 / portrait
    act(() => {
      useEditorStore.getState().setSize('5x7');
      useEditorStore.getState().setOrientation('landscape');
    });
    seedExtendedEntry('b'); // 스냅샷: 5x7 / landscape

    await act(async () => {
      fireEvent.click(screen.getByTestId('multi-checkout'));
    });

    expect(addToCartMock).toHaveBeenCalledTimes(2);
    const first = addToCartMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const second = addToCartMock.mock.calls[1]?.[0] as Record<string, unknown>;
    // 라인별 variant/가격/옵션 스냅샷.
    expect(first.variantId).toBe('v-4x6-black');
    expect(first.price).toBe(5000);
    expect(first.orientation).toBe('portrait');
    expect(first.projectSeq).toBe(0);
    expect(second.variantId).toBe('v-5x7-black');
    expect(second.price).toBe(9000);
    expect(second.orientation).toBe('landscape');
    expect(second.projectSeq).toBe(1);
    // projectId 는 세션당 1회 생성되어 모든 라인이 공유.
    expect(typeof first.projectId).toBe('string');
    expect(first.projectId).toBe(second.projectId);
    // 원본 사진 보존(ADR-020) + 베이크 크롭 URL 유지.
    expect(first.photoId).toBe('src-a');
    expect(first.photoUrl).toBe('https://x.supabase.co/photo-a.jpg');
    // 성공 시 현행과 동일: 트레이 비우고 카트로 이동.
    expect(useEditorStore.getState().entries).toHaveLength(0);
    expect(pushMock).toHaveBeenCalledWith('/cart');
  });

  it('묶음 담기 — 라인 1개여도 동작하고 projectId 가 부여된다', async () => {
    renderStudio('extended');
    seedExtendedEntry('solo');

    await act(async () => {
      fireEvent.click(screen.getByTestId('multi-checkout'));
    });

    expect(addToCartMock).toHaveBeenCalledTimes(1);
    const call = addToCartMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof call.projectId).toBe('string');
    expect(call.projectSeq).toBe(0);
    expect(pushMock).toHaveBeenCalledWith('/cart');
  });

  it('드래프트 v2 — kind/photoPool 이 저장 스냅샷에 포함된다', () => {
    renderStudio('extended');
    act(() => {
      useEditorStore.getState().addPhotoToPool(makePoolRef('pool-1'));
    });
    seedExtendedEntry('a');
    flushPersistDebounce();

    const draft = loadEditorDraft(SESSION, PRODUCT_ID);
    expect(draft).not.toBeNull();
    expect(draft?.version).toBe(2);
    expect(draft?.kind).toBe('extended');
    expect(draft?.photoPool).toHaveLength(1);
    expect(draft?.photoPool?.[0]?.photoId).toBe('pool-1');
    // 라인 스냅샷(옵션/방향)도 함께 영속화.
    expect(draft?.entries[0]?.selectedOptions?.sizeCode).toBe('4x6');
    expect(draft?.entries[0]?.orientation).toBe('portrait');
  });

  it('프리셀렉트 × mode=multi 공존 — 프리셀렉트 적용 + 기존 드래프트 보존(P1-001)', () => {
    saveEditorDraft(SESSION, PRODUCT_ID, {
      selectedOptions: DRAFT_OPTIONS,
      selectedVariantId: 'v-4x6-black',
      orientation: 'portrait',
      entries: [makeEntry('old')],
    });

    renderStudio('extended', { sizeCode: '5x7', orientation: 'landscape' });

    // URL 모드 + 프리셀렉트 둘 다 적용(드래프트 복원은 스킵).
    expect(useEditorStore.getState().kind).toBe('extended');
    expect(useEditorStore.getState().selectedOptions.sizeCode).toBe('5x7');
    expect(useEditorStore.getState().orientation).toBe('landscape');
    expect(useEditorStore.getState().entries).toHaveLength(0);

    // 무편집 debounce 이후에도 기존 드래프트는 살아 있다.
    flushPersistDebounce();
    const draft = loadEditorDraft(SESSION, PRODUCT_ID);
    expect(draft).not.toBeNull();
    expect(draft?.entries[0]?.entryId).toBe('old');
  });

  it('URL 모드 우선 — basic 드래프트 + multi 진입: entries 복원, kind 는 extended', () => {
    saveEditorDraft(SESSION, PRODUCT_ID, {
      selectedOptions: DRAFT_OPTIONS,
      selectedVariantId: 'v-4x6-black',
      orientation: 'portrait',
      entries: [makeEntry('old')],
      // kind 미지정 → 'basic' 으로 저장(현행 basic 경로와 동일).
    });

    renderStudio('extended');

    expect(useEditorStore.getState().kind).toBe('extended');
    expect(useEditorStore.getState().entries).toHaveLength(1);
    // 복원된 라인은 확장형 라인 카드로 렌더된다.
    expect(screen.getByTestId('line-list')).toBeInTheDocument();
  });

  it('URL 모드 우선 — extended 드래프트 + basic 진입: 복원 스킵 + 드래프트 보존', () => {
    saveEditorDraft(SESSION, PRODUCT_ID, {
      kind: 'extended',
      selectedOptions: DRAFT_OPTIONS,
      selectedVariantId: 'v-4x6-black',
      orientation: 'portrait',
      entries: [{ ...makeEntry('ext'), selectedOptions: DRAFT_OPTIONS, orientation: 'portrait' }],
      photoPool: [makePoolRef('pool-1')],
    });

    renderStudio(undefined); // basic 진입

    // 확장형 라인은 basic 결제 경로와 어긋나므로 복원하지 않는다.
    expect(useEditorStore.getState().kind).toBe('basic');
    expect(useEditorStore.getState().entries).toHaveLength(0);
    expect(useEditorStore.getState().photoPool).toHaveLength(0);

    // 빈 트레이 persist 가 드래프트를 지우지 않는다(P1-001 패턴).
    flushPersistDebounce();
    const draft = loadEditorDraft(SESSION, PRODUCT_ID);
    expect(draft).not.toBeNull();
    expect(draft?.kind).toBe('extended');
    expect(draft?.entries[0]?.entryId).toBe('ext');
  });

  it('풀에서 제거해도 이미 만든 라인은 유지된다', () => {
    renderStudio('extended');
    act(() => {
      useEditorStore.getState().addPhotoToPool(makePoolRef('pool-1'));
    });
    seedExtendedEntry('a');

    expect(useEditorStore.getState().photoPool).toHaveLength(1);
    fireEvent.click(screen.getByTestId('pool-remove'));

    expect(useEditorStore.getState().photoPool).toHaveLength(0);
    expect(useEditorStore.getState().entries).toHaveLength(1);
    expect(screen.getByTestId('line-list')).toBeInTheDocument();
  });
});

// ── FS-P1-FIX-B: 최종/보안 감사 적발 결함 회귀 고정 ─────────────────────────────

/** 직전 extended 세션의 잔존(스냅샷 라인 + 사진풀) 시뮬레이션 — SPA 교차 진입 재현. */
function seedExtendedResidue(): void {
  act(() => {
    const st = useEditorStore.getState();
    st.reset('extended');
    st.init({
      productId: asBrand<ProductId>(PRODUCT_ID),
      options: matrix(),
      defaultVariantId: asBrand<ProductVariantId>('v-4x6-black'),
      kind: 'extended',
    });
    st.addPhotoToPool(makePoolRef('leftover'));
    st.addEntry({
      photo: makePhoto('leftover-photo'),
      previewUrl: 'https://x.supabase.co/leftover-t.jpg',
    });
  });
}

describe('StudioClient — 교차 진입 스토어 오염 정리 (P0-002)', () => {
  it('extended 잔존 상태에서 basic 진입 → reset 후 basic 드래프트 복원 정상', () => {
    seedExtendedResidue();
    // 잔존 라인은 라인별 옵션 스냅샷을 보유한다(오염의 실체).
    expect(useEditorStore.getState().entries[0]?.selectedOptions).toBeDefined();

    // 이 세션·상품의 basic 드래프트는 정상 복원되어야 한다(수정의 비파괴 조건).
    saveEditorDraft(SESSION, PRODUCT_ID, {
      selectedOptions: DRAFT_OPTIONS,
      selectedVariantId: 'v-4x6-black',
      orientation: 'portrait',
      entries: [makeEntry('old')],
    });

    renderStudio(undefined); // basic 진입 (mode 미지정)

    const st = useEditorStore.getState();
    expect(st.kind).toBe('basic');
    expect(st.photoPool).toHaveLength(0);
    // 잔존 extended 라인은 사라지고 드래프트 라인만 남는다(스냅샷 없음 = basic 라인).
    expect(st.entries).toHaveLength(1);
    expect(st.entries[0]?.entryId).toBe('old');
    expect(st.entries[0]?.selectedOptions).toBeUndefined();
  });

  it('회귀 가드: 오염 없는 basic 재진입은 reset 미실행 — 인메모리 트레이 유지(현행 문자 그대로)', () => {
    // 현행: basic 세션의 in-memory 트레이는 SPA 재마운트에도 유지된다.
    act(() => {
      useEditorStore.getState().addEntry({
        photo: makePhoto('basic-photo'),
        previewUrl: 'https://x.supabase.co/basic-t.jpg',
      });
    });

    renderStudio(undefined);

    expect(useEditorStore.getState().kind).toBe('basic');
    expect(useEditorStore.getState().entries).toHaveLength(1);
    expect(screen.getByText(/담은 사진/)).toBeInTheDocument();
  });

  it('대칭: basic 잔존 상태에서 extended 진입은 기존대로 reset 된다', () => {
    act(() => {
      useEditorStore.getState().addEntry({
        photo: makePhoto('basic-photo'),
        previewUrl: 'https://x.supabase.co/basic-t.jpg',
      });
    });

    renderStudio('extended');

    expect(useEditorStore.getState().kind).toBe('extended');
    expect(useEditorStore.getState().entries).toHaveLength(0);
  });

  it('P2-003: 잔존 photoPool 이 basic 진입 후 kind:basic 드래프트로 새지 않는다', () => {
    act(() => {
      useEditorStore.getState().reset('extended');
      useEditorStore.getState().addPhotoToPool(makePoolRef('leftover'));
    });

    renderStudio(undefined);
    flushPersistDebounce();

    expect(useEditorStore.getState().photoPool).toHaveLength(0);
    expect(loadEditorDraft(SESSION, PRODUCT_ID)).toBeNull();
  });
});

describe('StudioClient — basic 드래프트 → multi 복원 스냅샷 승격 (P1-001)', () => {
  it('스냅샷 없는 라인에 드래프트의 전역 옵션/방향을 스탬프하고, 이후 전역 변경에 면역', () => {
    saveEditorDraft(SESSION, PRODUCT_ID, {
      selectedOptions: DRAFT_OPTIONS, // 4x6
      selectedVariantId: 'v-4x6-black',
      orientation: 'portrait',
      entries: [makeEntry('old')], // 스냅샷 없음(basic 라인)
    });

    renderStudio('extended');

    const entry = useEditorStore.getState().entries[0];
    expect(entry?.selectedOptions).toEqual(DRAFT_OPTIONS);
    expect(entry?.orientation).toBe('portrait');

    // 승격 효과: 전역 setSize 가 라인의 유효 옵션/가격을 암묵 변경하지 못한다.
    act(() => {
      useEditorStore.getState().setSize('5x7');
    });
    expect(screen.getByTestId('line-subtotal').textContent).toBe('5,000원');
  });

  it('이미 스냅샷 있는 라인은 승격 대상에서 제외(자기 스냅샷 유지)', () => {
    const snapOpts: SelectedOptions = { ...DRAFT_OPTIONS, sizeCode: '5x7' };
    saveEditorDraft(SESSION, PRODUCT_ID, {
      kind: 'extended',
      selectedOptions: DRAFT_OPTIONS, // 전역 4x6 / portrait
      selectedVariantId: 'v-4x6-black',
      orientation: 'portrait',
      entries: [
        { ...makeEntry('snap'), selectedOptions: snapOpts, orientation: 'landscape' },
        makeEntry('bare'),
      ],
    });

    renderStudio('extended');

    const [snap, bare] = useEditorStore.getState().entries;
    expect(snap?.selectedOptions?.sizeCode).toBe('5x7');
    expect(snap?.orientation).toBe('landscape');
    // ADR-025 불변식: extended 세션의 라인은 항상 스냅샷을 가진다.
    expect(bare?.selectedOptions?.sizeCode).toBe('4x6');
    expect(bare?.orientation).toBe('portrait');
  });
});

describe('StudioClient — 재크롭 필요 라인 담기 차단 (P1-002)', () => {
  it('기하 변경 라인 존재 → CTA 비활성 + "재편집 필요 N개" 사유 + 핸들러 이중 방어', async () => {
    renderStudio('extended');
    seedExtendedEntry('a');
    seedExtendedEntry('b');

    // 첫 라인만 사이즈 변경(라인 카드 이벤트 → 베이스라인 기록 + 기하 변경).
    const sizeSelects = screen.getAllByTestId('line-size-select');
    fireEvent.change(sizeSelects[0] as HTMLSelectElement, { target: { value: '5x7' } });

    expect(screen.getAllByTestId('recrop-badge')).toHaveLength(1);
    const cta = screen.getByTestId('multi-checkout');
    expect(cta).toBeDisabled();
    expect(screen.getByTestId('multi-blocked-reason').textContent).toContain(
      '재편집 필요 1개',
    );

    await act(async () => {
      fireEvent.click(cta);
    });
    expect(addToCartMock).not.toHaveBeenCalled();
  });

  it('기하를 베이크 값으로 되돌리면 차단 해제', () => {
    renderStudio('extended');
    seedExtendedEntry('a');

    const sizeSelect = screen.getByTestId('line-size-select');
    fireEvent.change(sizeSelect, { target: { value: '5x7' } });
    expect(screen.getByTestId('multi-checkout')).toBeDisabled();

    fireEvent.change(sizeSelect, { target: { value: '4x6' } });
    expect(screen.queryByTestId('recrop-badge')).toBeNull();
    expect(screen.queryByTestId('multi-blocked-reason')).toBeNull();
    expect(screen.getByTestId('multi-checkout')).toBeEnabled();
  });
});

describe('StudioClient — extended 담기 가드 라인 기준 (P2-002)', () => {
  it('무효 라인 → 비활성 + 사유 표시, 전역 variantId 없어도 라인 전부 유효하면 담기 진행', async () => {
    renderStudio('extended');
    seedExtendedEntry('a'); // 4x6 스냅샷(유효)
    const entryId = useEditorStore.getState().entries[0]?.entryId ?? '';

    // 라인을 판매하지 않는 조합으로 → CTA 비활성 + 사유 표시.
    act(() => {
      useEditorStore
        .getState()
        .updateLineOptions(entryId, { ...DRAFT_OPTIONS, colorCode: 'walnut' }, 'portrait');
    });
    expect(screen.getByTestId('multi-checkout')).toBeDisabled();
    expect(screen.getByTestId('multi-blocked-reason').textContent).toContain(
      '판매하지 않는 옵션 조합',
    );

    // 라인 복구 + 전역 variantId 를 비운다(전역 조합 비활성 시뮬레이션) —
    // 가드는 라인 유효성 기준이므로 담기가 진행되어야 한다.
    act(() => {
      useEditorStore.getState().updateLineOptions(entryId, DRAFT_OPTIONS, 'portrait');
      useEditorStore.setState({ selectedVariantId: null });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('multi-checkout'));
    });

    expect(addToCartMock).toHaveBeenCalledTimes(1);
    const call = addToCartMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.variantId).toBe('v-4x6-black');
    expect(pushMock).toHaveBeenCalledWith('/cart');
  });
});

describe('StudioClient — 사진풀 순차 업로드 429 구분 (FS-P1-security P2-003)', () => {
  it('429 는 분당 한도 안내 + 남은 파일 중단(이미 성공한 업로드는 유지)', async () => {
    vi.useRealTimers(); // fetch/waitFor 는 실타이머로.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ ok: true, photo: makePhoto('up-1') }),
      })
      .mockResolvedValueOnce({
        status: 429,
        json: async () => ({ ok: false }),
      });
    vi.stubGlobal('fetch', fetchMock);

    renderStudio('extended');
    const input = screen.getByTestId('pool-file-input');
    const files = [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'c.jpg', { type: 'image/jpeg' }),
    ];

    await act(async () => {
      fireEvent.change(input, { target: { files } });
    });

    await waitFor(() => {
      expect(screen.getByText(/분당 업로드 한도/)).toBeInTheDocument();
    });
    // 3번째 파일은 시도하지 않는다(중단) — 성공분(1장)은 풀에 유지.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useEditorStore.getState().photoPool).toHaveLength(1);
    expect(useEditorStore.getState().photoPool[0]?.photoId).toBe('up-1');
  });
});
