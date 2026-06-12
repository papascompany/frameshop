'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { OptionTabs } from '@/components/OptionTabs';
import { Button } from '@/components/ui/Button';
import { PriceTag } from '@/components/PriceTag';
import { ArtworkPicker } from '@/components/ArtworkPicker';
import { GooglePhotosPicker } from '@/components/GooglePhotosPicker';
import {
  useCurrentVariantPrice,
  useEditorStore,
  useEditorTotals,
} from '@/store/editor';
import { addToCart } from '@/lib/cart/client';
import { ImageResizeError, resizeImageToMax } from '@/lib/image/resize-client';
import { asBrand } from '@/types/common';
import type { PhotoId, ProductId, SessionId } from '@/types/common';
import { LONG_EDGE_RESIZE_PX } from '@/types/photo';
import type { OptionMatrix, ProductDetail } from '@/types/product';
import type { Photo } from '@/types/photo';
import type { StockPhoto } from '@/lib/db/stock-photos';
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
};

// 사진 소스 탭 타입
type PhotoSourceTab = 'upload' | 'artwork' | 'google';

export function StudioClient({
  sessionId,
  productDetail,
  options,
  artworks = [],
  googlePhotosEnabled = false,
}: Props) {
  const router = useRouter();
  const init = useEditorStore((s) => s.init);
  const setPhoto = useEditorStore((s) => s.setPhoto);
  const clearActivePhoto = useEditorStore((s) => s.clearActivePhoto);
  const setColor = useEditorStore((s) => s.setColor);
  const setSize = useEditorStore((s) => s.setSize);
  const setMatte = useEditorStore((s) => s.setMatte);
  const setPaper = useEditorStore((s) => s.setPaper);
  const photo = useEditorStore((s) => s.photo);
  const entries = useEditorStore((s) => s.entries);
  const addEntry = useEditorStore((s) => s.addEntry);
  const removeEntry = useEditorStore((s) => s.removeEntry);
  const setEntryQuantity = useEditorStore((s) => s.setEntryQuantity);
  const selected = useEditorStore((s) => s.selectedOptions);
  const variantId = useEditorStore((s) => s.selectedVariantId);
  const price = useCurrentVariantPrice();
  const { totalQuantity, totalPrice } = useEditorTotals();

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [photoSourceTab, setPhotoSourceTab] = useState<PhotoSourceTab>('upload');
  const canvasRef = useRef<FrameCanvasHandle | null>(null);

  useEffect(() => {
    init({
      productId: productDetail.product.id,
      options,
      defaultVariantId: productDetail.defaultVariantId,
    });
  }, [init, productDetail, options]);

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
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
        return;
      }

      const form = new FormData();
      form.append('file', payload, filename);
      form.append('sessionId', sessionId);
      const res = await fetch('/api/photos/upload', {
        method: 'POST',
        body: form,
      });
      const body = (await res.json()) as { ok: boolean; photo?: Photo };
      if (body.ok && body.photo) {
        setPhoto(body.photo);
      } else {
        setUploadError('사진 업로드에 실패했습니다.');
      }
    } finally {
      setUploading(false);
    }
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
  async function handleAddToTray() {
    if (!photo) return;
    setPlacing(true);
    setUploadError(null);
    try {
      const result = await canvasRef.current?.exportPrintCrop();
      if (!result) {
        setUploadError('크롭 이미지를 만들 수 없습니다. 잠시 후 다시 시도해 주세요.');
        return;
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
        });
        setPhotoSourceTab('upload');
      } else {
        setUploadError('이미지 처리에 실패했습니다. 다시 시도해 주세요.');
      }
    } catch {
      setUploadError('사진을 담는 중 오류가 발생했습니다.');
    } finally {
      setPlacing(false);
    }
  }

  /**
   * "장바구니 담기": add every tray entry as its own cart line (same options,
   * per-entry quantity), then go to the cart. Each entry's photo is the already
   * print-ready crop, so it is added with an identity transform.
   */
  async function handleCheckoutAll() {
    if (!variantId || entries.length === 0) return;
    setConfirming(true);
    try {
      for (const entry of entries) {
        await addToCart({
          userId: null,
          productId: productDetail.product.id,
          variantId,
          photoId: asBrand<PhotoId>(entry.photo.id),
          options: selected,
          photoUrl: entry.photo.originalUrl,
          cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
          previewUrl: entry.previewUrl,
          price,
          quantity: entry.quantity,
        });
      }
      router.push('/cart');
    } finally {
      setConfirming(false);
    }
  }

  /**
   * Size change clears the tray (baked crops no longer fit the new aspect).
   * Confirm with the user when entries would be discarded.
   */
  function handleSizeChange(code: string) {
    if (code === selected.sizeCode) return;
    if (
      entries.length > 0 &&
      !window.confirm('사이즈를 변경하면 담은 사진을 다시 맞춰야 합니다. 계속할까요?')
    ) {
      return;
    }
    setSize(code);
  }

  // 매트 라벨 매핑
  const matteLabels: Record<string, string> = { none: '없음', with: '있음' };
  // 인화지 라벨 매핑
  const paperLabels: Record<string, string> = {
    glossy: '유광',
    matte: '무광',
    fineart: '파인아트',
  };

  return (
    <Container size="lg" className="py-6 md:py-10">
      {/* PC: 2컬럼 레이아웃 */}
      <div className="md:grid md:grid-cols-[1fr_380px] md:gap-8">
        {/* 좌측: 캔버스 / 사진 소스 + 담은 사진 트레이 */}
        <div>
          <h1 className="text-xl font-bold mb-4">{productDetail.product.name}</h1>

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
          ) : (
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

          {/* 담은 사진 트레이 */}
          {entries.length > 0 ? (
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
          <OptionTabs
            label="사이즈"
            value={selected.sizeCode}
            onChange={handleSizeChange}
            options={options.sizes.map((s) => ({ value: s.code, label: s.label }))}
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

          {/* 합계 + 장바구니 담기 */}
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-mute mb-0.5">
                {totalQuantity > 0 ? `총 ${totalQuantity}장` : '낱장 단가'}
              </p>
              <PriceTag amount={totalQuantity > 0 ? totalPrice : price} variant="large" />
            </div>
          </div>

          <Button
            variant="primary"
            size="lg"
            disabled={entries.length === 0 || !variantId || confirming}
            onClick={() => void handleCheckoutAll()}
          >
            {confirming
              ? '담는 중…'
              : entries.length > 0
                ? `장바구니 담기 (${totalQuantity}장)`
                : '사진을 먼저 담아주세요'}
          </Button>

          {photo ? (
            <p className="text-xs text-muted-fg">
              현재 편집 중인 사진은 <b className="font-medium">이 사진 담기</b>를 눌러야 주문에 포함됩니다.
            </p>
          ) : null}

          <p className="text-xs text-muted-fg">
            ※ 미리보기는 화면 색공간 기준이며 실제 인쇄 결과와 차이가 있을 수 있습니다.
          </p>
        </div>
      </div>

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
