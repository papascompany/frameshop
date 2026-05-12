'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { OptionTabs } from '@/components/OptionTabs';
import { Button } from '@/components/ui/Button';
import { PriceTag } from '@/components/PriceTag';
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

const FrameCanvas = dynamic(() => import('./FrameCanvas'), {
  ssr: false,
  loading: () => (
    <div className="aspect-square bg-surface-muted grid place-items-center text-sm text-muted-fg">
      편집기를 불러오는 중...
    </div>
  ),
});

type Props = {
  sessionId: string;
  productDetail: ProductDetail;
  options: OptionMatrix;
};

export function StudioClient({ sessionId, productDetail, options }: Props) {
  const router = useRouter();
  const init = useEditorStore((s) => s.init);
  const setPhoto = useEditorStore((s) => s.setPhoto);
  const setColor = useEditorStore((s) => s.setColor);
  const setSize = useEditorStore((s) => s.setSize);
  const setMatte = useEditorStore((s) => s.setMatte);
  const photo = useEditorStore((s) => s.photo);
  const selected = useEditorStore((s) => s.selectedOptions);
  const variantId = useEditorStore((s) => s.selectedVariantId);
  const cropTransform = useEditorStore((s) => s.cropTransform);
  const price = useCurrentVariantPrice();

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
        // After resize the output is always JPEG, so swap the extension.
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

  async function addCurrentToCart() {
    if (!photo || !variantId) return;
    // For Phase 1, the editor preview URL falls back to the photo URL.
    // FrameCanvas (Phase 1) does not yet export a real preview snapshot;
    // that wires up in Phase 2 (see editor.md AC-9).
    await addToCart({
      userId: null,
      productId: productDetail.product.id,
      variantId,
      photoId: asBrand<PhotoId>(photo.id),
      options: selected,
      photoUrl: photo.originalUrl,
      cropTransform,
      previewUrl: photo.thumbUrl,
      price,
      quantity: 1,
    });
    router.push('/cart');
  }

  return (
    <Container size="lg" className="py-6 md:py-10">
      <h1 className="text-xl font-bold mb-4">{productDetail.product.name}</h1>

      {!photo ? (
        <PhotoSourceStep onFile={handleFile} uploading={uploading} error={uploadError} />
      ) : (
        <FrameCanvas photo={photo} productDetail={productDetail} options={options} />
      )}

      <div className="mt-6 flex flex-col gap-5">
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
        <OptionTabs
          label="매트"
          value={selected.matteCode}
          onChange={(v) => setMatte(v as 'none' | 'with')}
          options={options.mattes.map((m) => ({ value: m.code, label: m.label }))}
        />
      </div>

      <div className="mt-8 flex items-center justify-between gap-3">
        <PriceTag amount={price} variant="large" />
        <Button
          variant="primary"
          size="lg"
          disabled={!photo || !variantId}
          onClick={addCurrentToCart}
        >
          장바구니 담기
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-fg">
        ※ 미리보기는 화면 색공간 기준이며 실제 인쇄 결과와 차이가 있을 수 있습니다.
      </p>

      {/* sessionId is part of /studio/[id] path — keep here for testability */}
      <input type="hidden" data-testid="session-id" value={sessionId as unknown as SessionId} />
      <input type="hidden" data-testid="product-id" value={productDetail.product.id as unknown as ProductId} />
    </Container>
  );
}

function PhotoSourceStep({
  onFile,
  uploading,
  error,
}: {
  onFile: (file: File) => void;
  uploading: boolean;
  error: string | null;
}) {
  return (
    <div className="border border-border rounded-card p-6 text-center">
      <p className="text-base font-semibold mb-3">사진 가져오기</p>
      <p className="text-xs text-muted-fg mb-4">JPG, PNG, HEIC, WEBP (최대 50MB)</p>
      <label className="inline-block">
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
          className="inline-flex items-center justify-center h-11 px-6 bg-foreground text-background font-semibold cursor-pointer"
          aria-busy={uploading}
        >
          {uploading ? '업로드 중...' : '휴대폰 사진'}
        </span>
      </label>
      {error ? (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
