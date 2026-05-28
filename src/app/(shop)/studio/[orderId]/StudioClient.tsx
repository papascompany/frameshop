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
  const setColor = useEditorStore((s) => s.setColor);
  const setSize = useEditorStore((s) => s.setSize);
  const setMatte = useEditorStore((s) => s.setMatte);
  const setPaper = useEditorStore((s) => s.setPaper);
  const photo = useEditorStore((s) => s.photo);
  const selected = useEditorStore((s) => s.selectedOptions);
  const variantId = useEditorStore((s) => s.selectedVariantId);
  const confirmedCrop = useEditorStore((s) => s.confirmedCrop);
  const setConfirmedCrop = useEditorStore((s) => s.setConfirmedCrop);
  const price = useCurrentVariantPrice();

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
   * "사진 배치 확정": render the print-ready crop of the ORIGINAL photo
   * (full resolution, inner_rect + product bleed) and upload it as a new
   * photo record. The confirmed crop is what gets added to the cart.
   */
  async function handleConfirmPlacement() {
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
        setConfirmedCrop(body.photo);
      } else {
        setUploadError('크롭 이미지 업로드에 실패했습니다.');
      }
    } catch {
      setUploadError('사진 배치 확정 중 오류가 발생했습니다.');
    } finally {
      setPlacing(false);
    }
  }

  async function addCurrentToCart() {
    // The confirmed crop is already the exact print area; it is added with an
    // identity transform so the print pipeline does not re-crop it.
    if (!variantId || !confirmedCrop) return;
    setConfirming(true);
    try {
      await addToCart({
        userId: null,
        productId: productDetail.product.id,
        variantId,
        photoId: asBrand<PhotoId>(confirmedCrop.id),
        options: selected,
        photoUrl: confirmedCrop.originalUrl,
        cropTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
        previewUrl: confirmedCrop.thumbUrl ?? confirmedCrop.originalUrl,
        price,
        quantity: 1,
      });
      router.push('/cart');
    } finally {
      setConfirming(false);
    }
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
        {/* 좌측: 캔버스 */}
        <div>
          <h1 className="text-xl font-bold mb-4">{productDetail.product.name}</h1>

          {!photo ? (
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
            />
          ) : (
            <FrameCanvas
              ref={canvasRef}
              photo={photo}
              productDetail={productDetail}
              options={options}
            />
          )}
        </div>

        {/* 우측: 옵션 패널 */}
        <div className="mt-6 md:mt-0 flex flex-col gap-5">
          <OptionTabs
            label="사이즈"
            value={selected.sizeCode}
            onChange={setSize}
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

          <div className="mt-4 flex items-center justify-between gap-3">
            <PriceTag amount={price} variant="large" />
          </div>

          {/* 2-step flow: 사진 배치 확정 → 장바구니 담기 */}
          {!confirmedCrop ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                size="lg"
                disabled={!photo || placing}
                onClick={() => void handleConfirmPlacement()}
              >
                {placing ? '사진 배치 확정 중…' : '사진 배치 확정'}
              </Button>
              <p className="text-xs text-muted-fg">
                점선(인쇄 영역)에 맞춰 원본 화질 그대로 잘라낸 이미지를 만듭니다.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-md border border-hairline bg-soft-cloud px-3 py-2">
                <span aria-hidden className="text-base leading-none">✓</span>
                <p className="text-sm text-foreground">
                  사진 배치가 확정되었습니다.
                </p>
                <button
                  type="button"
                  className="ml-auto text-xs underline text-mute hover:text-foreground"
                  onClick={() => setConfirmedCrop(null)}
                >
                  다시 편집
                </button>
              </div>
              <Button
                variant="primary"
                size="lg"
                disabled={!variantId || confirming}
                onClick={() => void addCurrentToCart()}
              >
                {confirming ? '담는 중…' : '장바구니 담기'}
              </Button>
            </div>
          )}

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
          <UploadTab onFile={onFile} uploading={uploading} error={error} />
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
}: {
  onFile: (file: File) => void;
  uploading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 items-start">
      <p className="heading-md text-ink">사진 가져오기</p>
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
