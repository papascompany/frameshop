'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { OptionTabs } from '@/components/OptionTabs';
import { Button } from '@/components/ui/Button';
import { PriceTag } from '@/components/PriceTag';
import { MobileStickyBar } from '@/components/MobileStickyBar';
import { ArtworkPicker } from '@/components/ArtworkPicker';
import { GooglePhotosPicker } from '@/components/GooglePhotosPicker';
import {
  isLineVariantAvailable,
  suggestOrientation,
  useCurrentVariantPrice,
  useEditorStore,
  useEditorTotals,
} from '@/store/editor';
import { addToCart } from '@/lib/cart/client';
import {
  clearEditorDraft,
  loadEditorDraft,
  saveEditorDraft,
} from '@/lib/editor/draft';
import {
  resolveStudioPreselect,
  type ResolvedStudioPreselect,
} from '@/lib/wall/preselect';
import type { StudioPreselect } from '@/lib/wall/deeplink';
import { ImageResizeError, resizeImageToMax } from '@/lib/image/resize-client';
import { asBrand } from '@/types/common';
import type {
  CartProjectId,
  PhotoId,
  ProductId,
  ProductVariantId,
  SessionId,
} from '@/types/common';
import { LONG_EDGE_RESIZE_PX } from '@/types/photo';
import {
  variantKey,
  type OptionMatrix,
  type ProductDetail,
  type ProductVariant,
  type SelectedOptions,
} from '@/types/product';
import type { Photo } from '@/types/photo';
import type { EditorKind, EditorPhotoEntry } from '@/types/editor';
import type { ProjectPhotoRef } from '@/types/project';
import type { StockPhoto } from '@/lib/db/stock-photos';
import { PhotoPoolPanel } from './PhotoPoolPanel';
import { LineList } from './LineList';
import {
  MultiCheckoutBlockedReason,
  MultiCheckoutButton,
  MultiOptionsHint,
  MultiStickyBarContent,
} from './MultiCheckoutControls';
import type { FrameCanvasHandle } from './FrameCanvas';

const FrameCanvas = dynamic(() => import('./FrameCanvas'), {
  ssr: false,
  loading: () => (
    <div className="aspect-square bg-soft-cloud grid place-items-center text-sm text-mute">
      편집기를 불러오는 중...
    </div>
  ),
});

type Props = {
  sessionId: string;
  productDetail: ProductDetail;
  options: OptionMatrix;
  artworks?: StockPhoto[];
  googlePhotosEnabled?: boolean;
  /** FS-EC-04: 딥링크 프리셀렉트(size/color/orientation). null/absent = 기존 동작. */
  preselect?: StudioPreselect | null;
  /**
   * FS-P1-03 (ADR-025): URL `?mode=multi` → 'extended'(멀티포토 사진풀 +
   * 라인별 사이즈/방향/수량). 미지정 = 'basic' — 현행 단품 편집기와 완전 동일
   * (PhotoPoolPanel/LineList 미렌더, 기존 렌더 트리 문자 그대로).
   */
  kind?: EditorKind;
};

// 사진 소스 탭 타입
type PhotoSourceTab = 'upload' | 'artwork' | 'google';

export function StudioClient({
  sessionId,
  productDetail,
  options,
  artworks = [],
  googlePhotosEnabled = false,
  preselect = null,
  kind = 'basic',
}: Props) {
  const router = useRouter();
  const isExtended = kind === 'extended';
  const init = useEditorStore((s) => s.init);
  const reset = useEditorStore((s) => s.reset);
  const setPhoto = useEditorStore((s) => s.setPhoto);
  const clearActivePhoto = useEditorStore((s) => s.clearActivePhoto);
  const setColor = useEditorStore((s) => s.setColor);
  const setSize = useEditorStore((s) => s.setSize);
  const setMatte = useEditorStore((s) => s.setMatte);
  const setPaper = useEditorStore((s) => s.setPaper);
  const orientation = useEditorStore((s) => s.orientation);
  const setOrientation = useEditorStore((s) => s.setOrientation);
  const photo = useEditorStore((s) => s.photo);
  const entries = useEditorStore((s) => s.entries);
  const addEntry = useEditorStore((s) => s.addEntry);
  const removeEntry = useEditorStore((s) => s.removeEntry);
  const setEntryQuantity = useEditorStore((s) => s.setEntryQuantity);
  const clearEntries = useEditorStore((s) => s.clearEntries);
  const restoreDraft = useEditorStore((s) => s.restoreDraft);
  const selected = useEditorStore((s) => s.selectedOptions);
  const variantId = useEditorStore((s) => s.selectedVariantId);
  const price = useCurrentVariantPrice();
  const { totalQuantity, totalPrice } = useEditorTotals();
  // ── FS-P1-03 (ADR-025) extended 전용 상태 — basic 에선 전부 초기값/미사용 ──
  const photoPool = useEditorStore((s) => s.photoPool);
  const addPhotoToPool = useEditorStore((s) => s.addPhotoToPool);
  const removeFromPool = useEditorStore((s) => s.removeFromPool);
  const storeKind = useEditorStore((s) => s.kind);
  // 라인 중 비활성 조합이 있으면 담기 차단(가격 0 라인 방지). basic 은 항상 true.
  const allLinesAvailable = useEditorStore((s) =>
    s.entries.every((e) => isLineVariantAvailable(s, e)),
  );

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [photoSourceTab, setPhotoSourceTab] = useState<PhotoSourceTab>('upload');
  // extended: 순차 멀티 업로드 진행 표시(사진풀).
  const [poolProgress, setPoolProgress] = useState<{ done: number; total: number } | null>(null);
  // P1-002 (FS-P1-final): 기하 변경(재편집 권장 배지) 라인 수 — LineList 가
  // 보고한다. 0 이 아니면 묶음 담기를 차단하고 사유를 표시한다. 배지 베이스라인
  // (베이크 기하)이 LineList 로컬 state 라 새로고침/드래프트 복원 후에는 판정이
  // 초기화되어 차단도 함께 소실되는 한계가 있다 — 근본 해결은 베이크 기하의
  // 드래프트 영속화(타입 FROZEN, P2 백로그).
  const [needsRecropCount, setNeedsRecropCount] = useState(0);
  // extended: 이 세션에서 업로드한 풀 사진의 전체 Photo 객체(치수 포함) 캐시.
  // 드래프트 복원 풀(참조만 보존)은 여기 없을 수 있다 → 활성화 시 URL로 합성.
  const poolPhotosRef = useRef<Map<string, Photo>>(new Map());
  // 선결과제 3: 복원된 드래프트 안내 배너(복원 장수)는 스토어에 보관 — rehydrate
  // 이펙트가 React setState 없이(Next.js 16 react-hooks 규칙) 설정할 수 있도록.
  const restoredDraftCount = useEditorStore((s) => s.restoredDraftCount);
  const canvasRef = useRef<FrameCanvasHandle | null>(null);
  const hydratedRef = useRef(false);
  // P1-001 (ADR-022): when a deep-link preselect is applied we SKIP the draft
  // restore — but the persist effect below would then fire ~300ms after mount
  // with an EMPTY tray, and saveEditorDraft clears the stored draft on empty
  // entries, destroying the very draft we promised to keep. While this ref
  // holds the injected baseline, persistence is suppressed until the user
  // actually edits (tray gains an entry / options deviate from the baseline).
  const preselectBaselineRef = useRef<ResolvedStudioPreselect | null>(null);
  const productId = productDetail.product.id as string;

  // Init the store, then (once) rehydrate any saved draft for THIS session+product.
  // Draft is keyed by the stable sessionId so restored crops stay owned by the
  // same session → checkout photo-ownership 검증 무결성 유지.
  useEffect(() => {
    // FS-P1-03 (ADR-025): zustand 스토어는 전역이라 직전 상품/세션의 pool·entries
    // 가 메모리에 남아 있을 수 있다. 확장형 진입은 항상 깨끗한 세션에서 시작하고
    // (아래 드래프트 복원이 정본을 다시 채운다), basic 은 현행 경로 무접촉.
    if (kind === 'extended' && !hydratedRef.current) {
      reset('extended');
    }
    // P0-002 (FS-P1-final): extended → basic SPA 교차 진입 시 잔존 라인(라인별
    // 옵션 스냅샷 보유)·사진풀이 basic 결제 경로(전역 variant/가격)로 유입되면
    // "표시 합계 ≠ 청구액" + "베이크 기하 ≠ 주문 variant" 결함 주문이 된다.
    // 잔존이 감지될 때만 reset('basic') 후 진행(아래 드래프트 복원 흐름은 정상
    // 동작) — basic→basic 재진입(잔존 없음)은 현행 문자 그대로 reset 미실행
    // (회귀 0). extended 진입의 reset('extended') 와 대칭. P2-003(잔존 pool 이
    // kind:'basic' 드래프트로 새는 경로)도 이 reset 으로 함께 봉인된다.
    if (kind === 'basic' && !hydratedRef.current) {
      const st = useEditorStore.getState();
      const hasExtendedResidue =
        st.kind === 'extended' ||
        st.photoPool.length > 0 ||
        st.entries.some((e) => e.selectedOptions !== undefined);
      if (hasExtendedResidue) reset('basic');
    }
    init({
      productId: productDetail.product.id,
      options,
      defaultVariantId: productDetail.defaultVariantId,
      kind,
    });
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    // FS-EC-04: deep-link preselect (포토월 → 스튜디오) — applied ONCE on the
    // initial mount, only for codes that exist in the option matrix. Injected
    // directly as INITIAL option state (not via setSize/setOrientation, whose
    // semantics clear the tray) — the tray is empty at this point, so there
    // are no side effects. When applied, we skip the draft restore so the
    // deep-linked options are not overridden (the saved draft stays intact in
    // localStorage for a later plain visit). Without preselect params this
    // block is a no-op and the legacy path below runs unchanged.
    if (preselect) {
      const st = useEditorStore.getState();
      const resolved = resolveStudioPreselect(preselect, options, {
        selectedOptions: st.selectedOptions,
        selectedVariantId: st.selectedVariantId,
        orientation: st.orientation,
      });
      if (resolved) {
        useEditorStore.setState({
          selectedOptions: resolved.selectedOptions,
          selectedVariantId: resolved.selectedVariantId,
          orientation: resolved.orientation,
        });
        // Suppress draft persistence until the user actually edits, so the
        // mount-time empty-tray save cannot delete the saved draft (P1-001).
        preselectBaselineRef.current = resolved;
        return;
      }
    }
    const draft = loadEditorDraft(sessionId, productId);
    // ADR-025(드래프트 v2): 확장형은 라인 확정 전 사진풀만 채운 상태도 복원 가치가
    // 있다. basic/v1 승격 드래프트는 photoPool 이 없으므로 현행 조건과 동일.
    if (draft && (draft.entries.length > 0 || (draft.photoPool?.length ?? 0) > 0)) {
      if (draft.kind === 'extended' && kind === 'basic') {
        // URL 모드 우선(ADR-025): 확장형 드래프트를 basic 세션에 복원하면 라인별
        // 옵션 스냅샷이 basic 결제 경로(전역 variant/가격)와 어긋난다. 복원은
        // 건너뛰고 드래프트는 보존 — P1-001 과 동일하게, 마운트 직후의 빈 트레이
        // persist 가 드래프트를 지우지 않도록 baseline 으로 persist 를 억제한다.
        const st = useEditorStore.getState();
        preselectBaselineRef.current = {
          selectedOptions: st.selectedOptions,
          selectedVariantId: st.selectedVariantId,
          orientation: st.orientation,
        };
        return;
      }
      // P1-001 (FS-P1-final, ADR-025 불변식 복원): extended 세션의 라인은 "항상"
      // 옵션/방향 스냅샷을 가진다. basic(또는 v1 승격) 드래프트를 ?mode=multi 로
      // 복원할 때 스냅샷 없는 라인은 드래프트의 전역 옵션/방향을 스냅샷으로
      // 승격(스탬프)한다 — 이후 전역 setSize/setOrientation 이 라인의 유효
      // 옵션·가격·variant 를 암묵 변경하는 것(베이크 크롭은 구 기하 그대로)을
      // 차단한다. basic 진입은 현행 문자 그대로(승격 없음).
      const restoredEntries =
        kind === 'extended'
          ? draft.entries.map((e) =>
              e.selectedOptions
                ? e
                : {
                    ...e,
                    selectedOptions: { ...draft.selectedOptions },
                    orientation: e.orientation ?? draft.orientation,
                  },
            )
          : draft.entries;
      // restoreDraft sets restoredDraftCount in the store (external store update
      // — allowed in an effect, unlike React setState).
      restoreDraft({
        entries: restoredEntries,
        selectedOptions: draft.selectedOptions,
        selectedVariantId: draft.selectedVariantId
          ? asBrand<ProductVariantId>(draft.selectedVariantId)
          : null,
        orientation: draft.orientation,
        // 충돌 시 URL 모드 우선(ADR-025): basic 드래프트 + ?mode=multi 진입이면
        // entries 는 복원하되 kind 는 URL 로 판정된 값을 쓴다(draft.kind 아님).
        kind,
        photoPool: draft.photoPool,
      });
    }
  }, [init, reset, productDetail, options, sessionId, productId, restoreDraft, preselect, kind]);

  // Persist the tray + options whenever they change (lightly debounced so rapid
  // qty taps don't thrash localStorage). Empty tray clears the draft.
  useEffect(() => {
    const t = setTimeout(() => {
      // P1-001 (ADR-022): a deep-link preselect entry skipped the draft
      // restore. Until the user makes a real edit (tray entry added, or
      // options/orientation deviate from the injected baseline), skip the
      // save — persisting the pristine empty tray would delete the existing
      // draft for this (sessionId, productId). Read fresh store state so the
      // check is immune to closure staleness across the mount re-render.
      const baseline = preselectBaselineRef.current;
      if (baseline) {
        const s = useEditorStore.getState();
        const untouched =
          s.entries.length === 0 &&
          // ADR-025: 확장형에서 사진풀 추가도 "실제 편집"이다(풀만 채운 세션도
          // 복원 가치가 있음). basic 의 pool 은 항상 [] — 현행 판정과 동일.
          s.photoPool.length === 0 &&
          s.selectedOptions === baseline.selectedOptions &&
          s.selectedVariantId === baseline.selectedVariantId &&
          s.orientation === baseline.orientation;
        if (untouched) return;
        preselectBaselineRef.current = null; // real edit — resume persistence
      }
      saveEditorDraft(sessionId, productId, {
        selectedOptions: selected,
        selectedVariantId: variantId,
        orientation,
        entries,
        // ADR-025 (드래프트 v2): 모드 + 사진풀 스냅샷. basic 은 kind:'basic',
        // photoPool [] — saveEditorDraft 가 빈 풀을 생략해 현행 페이로드와 동등.
        kind: storeKind,
        photoPool,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [entries, selected, variantId, orientation, sessionId, productId, storeKind, photoPool]);

  /**
   * Resize + upload one file and return the created Photo (null on failure —
   * the user-facing error is set here). Shared by the basic single-photo flow
   * (`handleFile`) and the extended multi-upload pool flow (`handlePoolFiles`).
   * P2 (FS-P1-security): 429(분당 업로드 한도)는 일반 실패와 구분해 안내하고
   * `rateLimited` 로 알린다 — 순차 멀티 업로드가 남은 파일을 중단할 수 있도록.
   */
  async function uploadPhotoFile(
    file: File,
  ): Promise<{ photo: Photo | null; rateLimited: boolean }> {
    let payload: Blob;
    let filename: string;
    try {
      payload = await resizeImageToMax(file, LONG_EDGE_RESIZE_PX);
      filename = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    } catch (err) {
      if (err instanceof ImageResizeError) {
        setUploadError('이미지를 처리할 수 없습니다. JPEG/PNG 사진을 선택해주세요.');
      } else {
        setUploadError('이미지를 처리할 수 없습니다. JPEG/PNG 사진을 선택해주세요.');
      }
      return { photo: null, rateLimited: false };
    }

    const form = new FormData();
    form.append('file', payload, filename);
    form.append('sessionId', sessionId);
    const res = await fetch('/api/photos/upload', {
      method: 'POST',
      body: form,
    });
    const body = (await res.json()) as { ok: boolean; photo?: Photo };
    if (body.ok && body.photo) return { photo: body.photo, rateLimited: false };
    if (res.status === 429) {
      setUploadError('분당 업로드 한도에 도달했어요. 잠시 후 다시 시도해 주세요.');
      return { photo: null, rateLimited: true };
    }
    setUploadError('사진 업로드에 실패했습니다.');
    return { photo: null, rateLimited: false };
  }

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const { photo } = await uploadPhotoFile(file);
      if (photo) setPhoto(photo);
    } finally {
      setUploading(false);
    }
  }

  /**
   * FS-P1-03 (ADR-025, extended 전용): 멀티 파일을 순차 업로드해 사진풀에 넣는다.
   * 개별 실패는 건너뛰고 계속(에러 메시지는 마지막 실패 기준). 캔버스가 비어
   * 있으면 첫 성공 사진을 바로 활성화해 탭 한 번을 줄인다.
   * P2 (FS-P1-security): 429(분당 업로드 한도)는 남은 파일을 중단한다 — 이미
   * 성공한 사진은 풀에 유지되고, 안내 문구는 uploadPhotoFile 이 설정한다.
   */
  async function handlePoolFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    setPoolProgress({ done: 0, total: files.length });
    try {
      let firstUploaded: Photo | null = null;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let rateLimited = false;
        if (file) {
          const outcome = await uploadPhotoFile(file);
          rateLimited = outcome.rateLimited;
          if (outcome.photo) {
            poolPhotosRef.current.set(outcome.photo.id, outcome.photo);
            addPhotoToPool({
              photoId: outcome.photo.id,
              previewUrl: outcome.photo.thumbUrl ?? outcome.photo.originalUrl,
              originalUrl: outcome.photo.originalUrl,
            });
            firstUploaded ??= outcome.photo;
          }
        }
        setPoolProgress({ done: i + 1, total: files.length });
        if (rateLimited) break;
      }
      if (firstUploaded && !useEditorStore.getState().photo) {
        activatePhotoOnCanvas(firstUploaded);
      }
    } finally {
      setUploading(false);
      setPoolProgress(null);
    }
  }

  /** extended: 사진을 캔버스에 올린다 — 치수를 알면 방향을 best-fit 으로 제안. */
  function activatePhotoOnCanvas(photo: Photo) {
    if (
      typeof photo.widthPx === 'number' &&
      typeof photo.heightPx === 'number' &&
      photo.widthPx > 0 &&
      photo.heightPx > 0
    ) {
      // extended 의 setOrientation 은 트레이를 유지한다(ADR-025) — 담은 라인의
      // 방향 스냅샷은 그대로, 전역(새 라인 기본값)만 사진에 맞춘다.
      setOrientation(suggestOrientation(photo.widthPx, photo.heightPx));
    }
    setPhoto(photo);
  }

  /**
   * P2-004 (FS-P1-final): 드래프트 복원 풀/라인은 Photo 전체 객체가 없어 URL 로
   * 합성한다. 이중 캐스트(`as unknown as`) 없이 브랜드는 IO 경계 헬퍼 `asBrand`
   * 로만 부여한다(IsoTimestamp 는 string 별칭 — 캐스트 불필요). 치수 미상(null)
   * → activatePhotoOnCanvas 가 방향 제안을 건너뛰고 현재 방향을 유지한다.
   */
  function synthesizePhoto(args: {
    id: string;
    originalUrl: string;
    thumbUrl: string;
  }): Photo {
    return {
      id: asBrand<PhotoId>(args.id),
      userId: null,
      sessionId: asBrand<SessionId>(sessionId),
      originalUrl: args.originalUrl,
      thumbUrl: args.thumbUrl,
      widthPx: null,
      heightPx: null,
      exif: null,
      createdAt: new Date().toISOString(),
    };
  }

  /** extended: 풀 썸네일 탭 → 캔버스 활성. 드래프트 복원 풀(참조만 보존)은
   *  Photo 전체 객체가 없으므로 URL 로 합성한다(치수 미상 → 방향 유지). */
  function handlePoolSelect(ref: ProjectPhotoRef) {
    const cached = poolPhotosRef.current.get(ref.photoId);
    const photoObj: Photo =
      cached ??
      synthesizePhoto({
        id: ref.photoId,
        originalUrl: ref.originalUrl ?? ref.previewUrl,
        thumbUrl: ref.previewUrl,
      });
    activatePhotoOnCanvas(photoObj);
  }

  /**
   * extended: '다시 크롭하기' — 사이즈/방향이 바뀐 라인의 원본 사진을 캔버스에
   * 재활성화한다. 전역 옵션을 라인 스냅샷에 맞춰 캔버스 기하를 일치시킨 뒤
   * (extended 의 setSize/setOrientation 은 트레이 무접촉) 원본을 올린다.
   * 라인 자체는 유지 — 재크롭 후 "이 사진 담기"로 새 라인을 만들고 기존 라인은
   * 삭제로 정리하는 흐름(P1).
   */
  function handleLineReactivate(entry: EditorPhotoEntry) {
    const lineOpts = entry.selectedOptions ?? useEditorStore.getState().selectedOptions;
    setSize(lineOpts.sizeCode);
    setColor(lineOpts.colorCode);
    if (entry.orientation) setOrientation(entry.orientation);
    const sourceId = entry.sourcePhotoId ?? entry.photo.id;
    const cached = poolPhotosRef.current.get(sourceId);
    const photoObj: Photo =
      cached ??
      synthesizePhoto({
        id: sourceId,
        originalUrl: entry.sourcePhotoUrl ?? entry.photo.originalUrl,
        thumbUrl: entry.previewUrl,
      });
    setPhoto(photoObj);
  }

  /**
   * 명화 선택 — Stock Photo URL을 Photo 형태로 변환해서 setPhoto.
   */
  async function handleArtworkSelect(artwork: StockPhoto) {
    setUploading(true);
    setUploadError(null);
    try {
      // Stock Photo는 이미 Storage에 있으므로 업로드 없이 API를 통해 Photo 레코드 생성
      const form = new FormData();
      form.append('sessionId', sessionId);
      form.append('imageUrl', artwork.imageUrl);
      form.append('thumbUrl', artwork.thumbUrl);
      form.append('widthPx', String(artwork.widthPx));
      form.append('heightPx', String(artwork.heightPx));
      form.append('source', 'artwork');

      const res = await fetch('/api/photos/upload', {
        method: 'POST',
        body: form,
      });
      const body = (await res.json()) as { ok: boolean; photo?: Photo };
      if (body.ok && body.photo) {
        setPhoto(body.photo);
      } else {
        // fallback: URL 직접 사용 (API가 artwork source를 지원하지 않는 경우)
        setUploadError(null);
        const mockPhoto: Photo = {
          id: asBrand<PhotoId>(artwork.id),
          userId: null,
          sessionId: sessionId as unknown as import('@/types/common').SessionId,
          originalUrl: artwork.imageUrl,
          thumbUrl: artwork.thumbUrl,
          widthPx: artwork.widthPx,
          heightPx: artwork.heightPx,
          exif: null,
          createdAt: artwork.createdAt as unknown as import('@/types/common').IsoTimestamp,
        };
        setPhoto(mockPhoto);
      }
    } catch {
      setUploadError('명화를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  }

  /**
   * Google Photos 선택 — URL + 크기 정보로 mock Photo 생성.
   */
  function handleGooglePhotoSelect(photoUrl: string, width: number, height: number) {
    const mockPhoto: Photo = {
      id: asBrand<PhotoId>(crypto.randomUUID()),
      userId: null,
      sessionId: sessionId as unknown as import('@/types/common').SessionId,
      originalUrl: photoUrl,
      thumbUrl: photoUrl + '=w400-h400',
      widthPx: width,
      heightPx: height,
      exif: null,
      createdAt: new Date().toISOString() as unknown as import('@/types/common').IsoTimestamp,
    };
    setPhoto(mockPhoto);
  }

  /**
   * "담기": render the print-ready crop of the active photo (full-res,
   * inner_rect + bleed), re-upload it, and push it into the order tray. The
   * canvas then resets so the next photo can be placed. Multiple photos share
   * the same options and are added to the cart together later.
   */
  /** Render + upload the active photo's print crop and push it into the tray.
   *  Returns true on success. */
  async function handleAddToTray(): Promise<boolean> {
    // Capture the ORIGINAL photo + the real crop transform BEFORE baking, so the
    // tray entry preserves the source (선결과제 1) even though the uploaded crop
    // gets a brand-new photoId. Read from the store directly to avoid closure
    // staleness across the upload await.
    const sourcePhoto = useEditorStore.getState().photo;
    const sourceTransform = useEditorStore.getState().cropTransform;
    if (!sourcePhoto) return false;
    setPlacing(true);
    setUploadError(null);
    try {
      const result = await canvasRef.current?.exportPrintCrop();
      if (!result) {
        setUploadError('크롭 이미지를 만들 수 없습니다. 잠시 후 다시 시도해 주세요.');
        return false;
      }
      const form = new FormData();
      form.append('file', result.blob, `cropped-${crypto.randomUUID()}.jpg`);
      form.append('sessionId', sessionId);
      const res = await fetch('/api/photos/upload', { method: 'POST', body: form });
      const body = (await res.json()) as { ok: boolean; photo?: Photo };
      if (body.ok && body.photo) {
        addEntry({
          photo: body.photo,
          previewUrl: body.photo.thumbUrl ?? body.photo.originalUrl,
          sourcePhotoId: sourcePhoto.id,
          sourcePhotoUrl: sourcePhoto.originalUrl,
          cropTransform: sourceTransform,
        });
        setPhotoSourceTab('upload');
        return true;
      }
      setUploadError('이미지 처리에 실패했습니다. 다시 시도해 주세요.');
      return false;
    } catch {
      setUploadError('사진을 담는 중 오류가 발생했습니다.');
      return false;
    } finally {
      setPlacing(false);
    }
  }

  /**
   * "장바구니 담기": add every tray entry as its own cart line (same options,
   * per-entry quantity), then go to the cart. Each entry's photo is the already
   * print-ready crop, so it is added with an identity transform.
   *
   * #8: if a photo is still being placed on the canvas (not yet in the tray),
   * include it automatically so it is never silently dropped at checkout.
   */
  async function handleCheckoutAll() {
    if (isExtended) {
      // P2-002 (FS-P1-final): extended 가드는 전역 variantId(새 라인 기본값)가
      // 아니라 라인 유효성 — 모든 라인의 variant 존재(allLinesAvailable) — 로
      // 판정한다(무효 라인 사유는 MultiCheckoutBlockedReason 이 상시 표시).
      // P1-002: 재크롭 필요 라인이 있으면 담기 차단(버튼 비활성과 이중 방어).
      if (!allLinesAvailable || needsRecropCount > 0) return;
      await handleCheckoutAllExtended();
      return;
    }
    if (!variantId) return;
    setConfirming(true);
    try {
      if (photo) {
        const ok = await handleAddToTray();
        if (!ok) return; // upload failed — keep the user on the editor
      }
      // Read the freshest tray (handleAddToTray updates the store async).
      const all = useEditorStore.getState().entries;
      if (all.length === 0) return;
      for (const entry of all) {
        await addToCart({
          userId: null,
          productId: productDetail.product.id,
          variantId,
          // 선결과제 1: photoId = ORIGINAL 사진(있으면). photoUrl 은 그대로
          // 베이크 크롭(인쇄 마스터 + 소유권 확인 키)이라 인쇄 경로는 무변경.
          // cropTransform 도 실제 변형을 보존(없으면 identity 폴백).
          photoId: entry.sourcePhotoId ?? asBrand<PhotoId>(entry.photo.id),
          options: selected,
          photoUrl: entry.photo.originalUrl,
          cropTransform: entry.cropTransform ?? { x: 0, y: 0, scale: 1, rotation: 0 },
          previewUrl: entry.previewUrl,
          price,
          quantity: entry.quantity,
        });
      }
      // 주문으로 넘어갔으니 편집 세션을 비운다(트레이 + 저장된 드래프트) — 돌아와도
      // 이미 담은 항목이 되살아나지 않게.
      clearEntries();
      clearEditorDraft(sessionId, productId);
      router.push('/cart');
    } finally {
      setConfirming(false);
    }
  }

  /**
   * FS-P1-03 (ADR-025, extended 전용) — 묶음 담기. 세션당 1회 projectLocalId 를
   * 생성해 모든 라인이 공유하고, 라인별 스냅샷(사이즈/방향/수량)으로 variant 를
   * 파생해 addToCart({projectId, projectSeq, orientation}) 를 라인 수만큼 호출한다
   * (FS-P1-02 계약 — 서버 probe/스냅샷 동결은 서버가 담당). 라인 1개여도 동일하게
   * 동작한다(projectId 는 부여). 성공 시 현행과 동일하게 카트로 이동.
   */
  async function handleCheckoutAllExtended() {
    setConfirming(true);
    try {
      // #8 동일 원칙: 캔버스에서 편집 중인 사진은 자동으로 함께 담는다.
      if (useEditorStore.getState().photo) {
        const ok = await handleAddToTray();
        if (!ok) return;
      }
      const all = useEditorStore.getState().entries;
      if (all.length === 0) return;
      // 라인별 variant 를 먼저 전부 해석 — 하나라도 비활성 조합이면 아무것도
      // 담지 않고 중단(부분 담김 방지). UI 는 useLineAvailability 로 선경고.
      const globalOpts = useEditorStore.getState().selectedOptions;
      const globalOrientation = useEditorStore.getState().orientation;
      const lines: Array<{
        entry: EditorPhotoEntry;
        opts: SelectedOptions;
        variant: ProductVariant;
      }> = [];
      for (const entry of all) {
        const opts = entry.selectedOptions ?? globalOpts;
        const lineVariant = options.variantsByKey[variantKey(opts)];
        if (!lineVariant) {
          setUploadError('판매하지 않는 옵션 조합의 라인이 있어요. 라인 옵션을 변경해 주세요.');
          return;
        }
        lines.push({ entry, opts, variant: lineVariant });
      }
      const projectLocalId = asBrand<CartProjectId>(crypto.randomUUID());
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const { entry, opts, variant: lineVariant } = line;
        await addToCart({
          userId: null,
          productId: productDetail.product.id,
          variantId: lineVariant.id,
          // ADR-020: photoId = 원본(있으면), photoUrl = 베이크 크롭(인쇄 마스터).
          photoId: entry.sourcePhotoId ?? asBrand<PhotoId>(entry.photo.id),
          options: opts,
          photoUrl: entry.photo.originalUrl,
          cropTransform: entry.cropTransform ?? { x: 0, y: 0, scale: 1, rotation: 0 },
          previewUrl: entry.previewUrl,
          price: lineVariant.price,
          quantity: entry.quantity,
          projectId: projectLocalId,
          projectSeq: i,
          orientation: entry.orientation ?? globalOrientation,
        });
      }
      // 세션 정리: 트레이 + 사진풀 + 저장된 드래프트. 풀까지 비워야 이탈 직전의
      // debounce persist 가 풀-only 드래프트를 되살리지 않는다.
      clearEntries();
      for (const ref of useEditorStore.getState().photoPool) {
        removeFromPool(ref.photoId);
      }
      poolPhotosRef.current.clear();
      clearEditorDraft(sessionId, productId);
      router.push('/cart');
    } finally {
      setConfirming(false);
    }
  }

  /**
   * Size change clears the tray (baked crops no longer fit the new aspect).
   * Confirm with the concrete count so the cost is visible (#12).
   * extended(ADR-025): 라인이 옵션 스냅샷을 보유해 트레이가 유지되므로 확인 없이
   * "새 라인 기본값"만 변경한다.
   */
  function handleSizeChange(code: string) {
    if (code === selected.sizeCode) return;
    if (
      !isExtended &&
      entries.length > 0 &&
      !window.confirm(`사이즈를 변경하면 담은 사진 ${entries.length}종이 초기화됩니다. 계속할까요?`)
    ) {
      return;
    }
    setSize(code);
  }

  function handleOrientationChange(o: string) {
    if (o === orientation) return;
    if (
      !isExtended &&
      entries.length > 0 &&
      !window.confirm(`방향을 변경하면 담은 사진 ${entries.length}종이 초기화됩니다. 계속할까요?`)
    ) {
      return;
    }
    setOrientation(o as 'portrait' | 'landscape');
  }

  // 결제 가능 여부: 트레이에 사진이 있거나, 편집 중인 사진이 있으면(담기 후 주문).
  // extended 는 추가로 모든 라인의 옵션 조합이 유효해야 한다(ADR-025) — basic 은
  // allLinesAvailable 조건이 항상 참이라 현행 판정과 동일.
  const canCheckout =
    (entries.length > 0 || !!photo) && (!isExtended || allLinesAvailable);
  // extended CTA 비활성 판정(P2-002): 전역 variantId 는 "새 라인 기본값"일 뿐이라
  // 라인 유효성(canCheckout 의 allLinesAvailable)으로만 가드하고, P1-002 재크롭
  // 필요 라인이 있으면 함께 차단한다(사유는 MultiCheckoutBlockedReason).
  const multiCheckoutDisabled = !canCheckout || confirming || needsRecropCount > 0;
  // extended CTA 라벨용 라인 수(편집 중 사진은 담기 시 자동 포함).
  const multiLineCount = entries.length + (photo ? 1 : 0);
  const checkoutLabel = confirming
    ? '담는 중…'
    : totalQuantity > 0
      ? `장바구니 담기 (${totalQuantity}장)`
      : photo
        ? '장바구니 담기'
        : '사진을 먼저 담아주세요';

  // 매트 라벨 매핑
  const matteLabels: Record<string, string> = { none: '없음', with: '있음' };
  // 인화지 라벨 매핑
  const paperLabels: Record<string, string> = {
    glossy: '유광',
    matte: '무광',
    fineart: '파인아트',
  };

  return (
    <Container size="lg" className="pt-6 pb-28 md:py-10">
      {/* PC: 2컬럼 레이아웃 */}
      <div className="md:grid md:grid-cols-[1fr_380px] md:gap-8">
        {/* 좌측: 캔버스 / 사진 소스 + 담은 사진 트레이 */}
        <div>
          <h1 className="text-xl font-bold mb-4">{productDetail.product.name}</h1>

          {restoredDraftCount != null && entries.length > 0 ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-hairline bg-soft-cloud px-3 py-2 text-sm">
              <span className="text-mute">
                이전에 작업하던 사진 <b className="font-medium text-foreground">{restoredDraftCount}장</b>을 불러왔어요.
              </span>
              <button
                type="button"
                className="shrink-0 underline text-mute hover:text-foreground"
                onClick={() => {
                  clearEntries();
                  if (isExtended) {
                    // 확장형 '새로 시작'은 사진풀까지 비운다(풀-only 드래프트가
                    // debounce persist 로 되살아나지 않도록).
                    for (const ref of useEditorStore.getState().photoPool) {
                      removeFromPool(ref.photoId);
                    }
                    poolPhotosRef.current.clear();
                  }
                  clearEditorDraft(sessionId, productId);
                }}
              >
                새로 시작
              </button>
            </div>
          ) : null}

          {/* FS-P1-03 (ADR-025): 확장형 사진 보관함 — 멀티 업로드 + 탭하여 편집.
              모바일은 가로 스크롤 스트립, md+ 는 그리드. basic 미렌더(회귀 0). */}
          {isExtended ? (
            <PhotoPoolPanel
              pool={photoPool}
              activePhotoId={photo?.id ?? null}
              uploading={uploading}
              progress={poolProgress}
              error={photo ? null : uploadError}
              onFiles={(files) => void handlePoolFiles(files)}
              onSelect={handlePoolSelect}
              onRemove={removeFromPool}
            />
          ) : null}

          {photo ? (
            <>
              <FrameCanvas
                ref={canvasRef}
                photo={photo}
                productDetail={productDetail}
                options={options}
              />
              <div className="mt-3 flex flex-col gap-2">
                <Button
                  variant="primary"
                  size="lg"
                  disabled={placing}
                  onClick={() => void handleAddToTray()}
                >
                  {placing ? '담는 중…' : '이 사진 담기'}
                </Button>
                <button
                  type="button"
                  className="self-center text-xs underline text-mute hover:text-foreground"
                  onClick={clearActivePhoto}
                  disabled={placing}
                >
                  이 사진 취소
                </button>
                {uploadError ? (
                  <p role="alert" className="caption-md text-red-600 text-center">{uploadError}</p>
                ) : null}
              </div>
            </>
          ) : isExtended ? null : (
            <PhotoSourceStep
              tab={photoSourceTab}
              onTabChange={setPhotoSourceTab}
              onFile={handleFile}
              uploading={uploading}
              error={uploadError}
              artworks={artworks}
              onArtworkSelect={(a) => void handleArtworkSelect(a)}
              googlePhotosEnabled={googlePhotosEnabled}
              onGooglePhotoSelect={handleGooglePhotoSelect}
              heading={entries.length > 0 ? '사진 추가' : undefined}
            />
          )}

          {/* 담은 사진 트레이 — extended 는 라인 카드 목록(LineList)으로 대체 */}
          {entries.length > 0 && isExtended ? (
            <LineList
              options={options}
              onReactivate={handleLineReactivate}
              onNeedsRecropChange={setNeedsRecropCount}
            />
          ) : null}
          {entries.length > 0 && !isExtended ? (
            <div className="mt-6">
              <p className="text-sm font-medium mb-2">
                담은 사진 <span className="text-mute">({entries.length}종 · 총 {totalQuantity}장)</span>
              </p>
              <ul className="flex flex-col gap-2">
                {entries.map((e) => (
                  <li
                    key={e.entryId}
                    className="flex items-center gap-3 border border-hairline rounded-md p-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={e.previewUrl}
                      alt="담은 사진"
                      className="w-14 h-14 object-cover rounded bg-soft-cloud shrink-0"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="수량 감소"
                        className="w-8 h-8 rounded border border-hairline grid place-items-center disabled:opacity-40"
                        onClick={() => setEntryQuantity(e.entryId, e.quantity - 1)}
                        disabled={e.quantity <= 1}
                      >
                        −
                      </button>
                      <span className="w-8 text-center tabular-nums text-sm">{e.quantity}</span>
                      <button
                        type="button"
                        aria-label="수량 증가"
                        className="w-8 h-8 rounded border border-hairline grid place-items-center disabled:opacity-40"
                        onClick={() => setEntryQuantity(e.entryId, e.quantity + 1)}
                        disabled={e.quantity >= 99}
                      >
                        ＋
                      </button>
                    </div>
                    <span className="ml-auto text-sm tabular-nums text-mute">
                      {(price * e.quantity).toLocaleString('ko-KR')}원
                    </span>
                    <button
                      type="button"
                      aria-label="삭제"
                      className="text-mute hover:text-foreground px-1"
                      onClick={() => removeEntry(e.entryId)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* 우측: 옵션 패널 */}
        <div className="mt-6 md:mt-0 flex flex-col gap-5">
          {isExtended ? <MultiOptionsHint /> : null}
          <OptionTabs
            label="사이즈"
            value={selected.sizeCode}
            onChange={handleSizeChange}
            options={options.sizes.map((s) => ({ value: s.code, label: s.label }))}
          />
          <OptionTabs
            label="방향"
            value={orientation}
            onChange={handleOrientationChange}
            options={[
              { value: 'portrait', label: '세로형' },
              { value: 'landscape', label: '가로형' },
            ]}
          />
          <OptionTabs
            label="액자 색상"
            value={selected.colorCode}
            onChange={setColor}
            options={options.colors.map((c) => ({ value: c.code, label: c.label }))}
          />
          {options.mattes.length > 0 ? (
            <OptionTabs
              label="매트"
              value={selected.matteCode}
              onChange={(v) => setMatte(v as 'none' | 'with')}
              options={options.mattes.map((m) => ({
                value: m.code,
                label: matteLabels[m.code] ?? m.label,
              }))}
            />
          ) : null}
          {options.papers.length > 0 ? (
            <OptionTabs
              label="인화지"
              value={selected.paperCode}
              onChange={(v) => setPaper(v as 'glossy' | 'matte' | 'fineart')}
              options={options.papers.map((p) => ({
                value: p.code,
                label: paperLabels[p.code] ?? p.label,
              }))}
            />
          ) : null}

          {/* 합계 + 장바구니 담기 (데스크톱) */}
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-mute mb-0.5">
                {totalQuantity > 0 ? `총 ${totalQuantity}장` : '낱장 단가'}
              </p>
              <PriceTag amount={totalQuantity > 0 ? totalPrice : price} variant="large" />
            </div>
          </div>

          {isExtended ? (
            <>
              <MultiCheckoutButton
                count={multiLineCount}
                confirming={confirming}
                disabled={multiCheckoutDisabled}
                onClick={() => void handleCheckoutAll()}
                className="hidden md:flex"
              />
              <MultiCheckoutBlockedReason
                recropCount={needsRecropCount}
                unavailable={!allLinesAvailable}
              />
            </>
          ) : (
            <Button
              variant="primary"
              size="lg"
              disabled={!canCheckout || !variantId || confirming}
              onClick={() => void handleCheckoutAll()}
              className="hidden md:flex"
            >
              {checkoutLabel}
            </Button>
          )}

          {photo && entries.length > 0 ? (
            <p className="text-xs text-muted-fg">
              편집 중인 사진은 <b className="font-medium">장바구니 담기</b> 시 함께 담깁니다.
            </p>
          ) : null}

          <p className="text-xs text-muted-fg">
            ※ 미리보기는 화면 색공간 기준이며 실제 인쇄 결과와 차이가 있을 수 있습니다.
          </p>
        </div>
      </div>

      {/* 모바일: 하단 고정 장바구니 바 — extended 는 합계 + "N개 라인 담기" */}
      <MobileStickyBar>
        {isExtended ? (
          <MultiStickyBarContent
            totalQuantity={totalQuantity}
            totalPrice={totalPrice}
            unitPrice={price}
            count={multiLineCount}
            confirming={confirming}
            disabled={multiCheckoutDisabled}
            onClick={() => void handleCheckoutAll()}
          />
        ) : (
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-mute leading-none mb-0.5">
                {totalQuantity > 0 ? `총 ${totalQuantity}장` : '낱장 단가'}
              </p>
              <PriceTag amount={totalQuantity > 0 ? totalPrice : price} variant="large" />
            </div>
            <Button
              variant="primary"
              size="lg"
              className="ml-auto"
              disabled={!canCheckout || !variantId || confirming}
              onClick={() => void handleCheckoutAll()}
            >
              {checkoutLabel}
            </Button>
          </div>
        )}
      </MobileStickyBar>

      <input type="hidden" data-testid="session-id" value={sessionId as unknown as SessionId} />
      <input type="hidden" data-testid="product-id" value={productDetail.product.id as unknown as ProductId} />
    </Container>
  );
}

// ── 사진 소스 선택 단계 ────────────────────────────────────────────────────────

type PhotoSourceStepProps = {
  tab: PhotoSourceTab;
  onTabChange: (tab: PhotoSourceTab) => void;
  onFile: (file: File) => void;
  uploading: boolean;
  error: string | null;
  artworks: StockPhoto[];
  onArtworkSelect: (artwork: StockPhoto) => void;
  googlePhotosEnabled: boolean;
  onGooglePhotoSelect: (photoUrl: string, width: number, height: number) => void;
  /** Heading for the upload tab — "사진 추가" when the tray already has photos. */
  heading?: string;
};

function PhotoSourceStep({
  tab,
  onTabChange,
  onFile,
  uploading,
  error,
  artworks,
  onArtworkSelect,
  googlePhotosEnabled,
  onGooglePhotoSelect,
  heading,
}: PhotoSourceStepProps) {
  const tabs: { id: PhotoSourceTab; label: string }[] = [
    { id: 'upload', label: '내 사진' },
    { id: 'artwork', label: '명화 선택' },
    ...(googlePhotosEnabled ? [{ id: 'google' as PhotoSourceTab, label: 'Google Photos' }] : []),
  ];

  return (
    <div className="border border-hairline">
      {/* 탭 헤더 */}
      <div className="flex border-b border-hairline">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-ink text-on-primary'
                : 'text-mute hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === 'upload' ? (
          <UploadTab onFile={onFile} uploading={uploading} error={error} heading={heading} />
        ) : tab === 'artwork' ? (
          <div className="space-y-3">
            <p className="caption-md text-mute">
              명화를 선택하면 바로 액자에 넣어볼 수 있습니다.
            </p>
            <ArtworkPicker artworks={artworks} onSelect={onArtworkSelect} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="caption-md text-mute">
              Google 계정에 연결하여 보관함 사진을 사용할 수 있습니다.
            </p>
            <GooglePhotosPicker
              isEnabled={googlePhotosEnabled}
              onSelect={onGooglePhotoSelect}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function UploadTab({
  onFile,
  uploading,
  error,
  heading,
}: {
  onFile: (file: File) => void;
  uploading: boolean;
  error: string | null;
  heading?: string;
}) {
  return (
    <div className="flex flex-col gap-3 items-start">
      <p className="heading-md text-ink">{heading ?? '사진 가져오기'}</p>
      <p className="caption-md text-mute">
        JPG, PNG, HEIC, WEBP (최대 50MB)
      </p>
      <p className="caption-md text-mute max-w-[40ch]">
        사진은 가운데 액자 안에 자동으로 맞춰집니다. 업로드 후 드래그로 위치를 조정할 수 있어요.
      </p>
      <label className="inline-block mt-2">
        <input
          type="file"
          accept="image/jpeg,image/png,image/heic,image/webp"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <span
          className="inline-flex items-center justify-center h-11 px-6 rounded-[30px] bg-ink text-on-primary body-strong cursor-pointer tap-collapse"
          aria-busy={uploading}
        >
          {uploading ? '업로드 중…' : '휴대폰 사진'}
        </span>
      </label>
      {error ? (
        <p role="alert" className="mt-1 caption-md text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
