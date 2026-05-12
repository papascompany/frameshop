'use client';

import { useEffect, useRef, useState } from 'react';
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
import { getBrowserSupabase } from '@/lib/supabase/client';
import { asBrand } from '@/types/common';
import type { PhotoId, ProductId, SessionId } from '@/types/common';
import { LONG_EDGE_RESIZE_PX } from '@/types/photo';
import type { OptionMatrix, ProductDetail } from '@/types/product';
import type { Photo } from '@/types/photo';
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
  const [confirming, setConfirming] = useState(false);
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

  /**
   * Capture the live Konva preview to a PNG and upload it to the `previews`
   * Storage bucket. Returns the public URL on success or `null` on failure
   * (caller falls back to the photo thumbnail).
   *
   * frame_skills.md §4 + editor.md AC-9: previewUrl saved on the cart item
   * is the composed (photo + frame) snapshot, not just the bare photo.
   */
  async function uploadPreviewSnapshot(): Promise<string | null> {
    const dataUrl = canvasRef.current?.toDataURL({ pixelRatio: 2, mimeType: 'image/png' });
    if (!dataUrl) return null;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const supabase = getBrowserSupabase();
      const path = `${sessionId}/${crypto.randomUUID()}.png`;
      const { error } = await supabase.storage
        .from('previews')
        .upload(path, blob, {
          contentType: 'image/png',
          upsert: false,
        });
      if (error) {
        console.warn('preview upload failed:', error.message);
        return null;
      }
      const { data } = supabase.storage.from('previews').getPublicUrl(path);
      return data.publicUrl ?? null;
    } catch (err) {
      console.warn('preview snapshot threw:', err);
      return null;
    }
  }

  async function addCurrentToCart() {
    if (!photo || !variantId) return;
    setConfirming(true);
    try {
      const composedPreview = await uploadPreviewSnapshot();
      // cartItemSchema requires previewUrl to be https — fall back to the
      // server-issued photo thumbnail when Storage upload fails (still https).
      const previewUrl = composedPreview ?? photo.thumbUrl;
      await addToCart({
        userId: null,
        productId: productDetail.product.id,
        variantId,
        photoId: asBrand<PhotoId>(photo.id),
        options: selected,
        photoUrl: photo.originalUrl,
        cropTransform,
        previewUrl,
        price,
        quantity: 1,
      });
      router.push('/cart');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Container size="lg" className="py-6 md:py-10">
      <h1 className="text-xl font-bold mb-4">{productDetail.product.name}</h1>

      {!photo ? (
        <PhotoSourceStep onFile={handleFile} uploading={uploading} error={uploadError} />
      ) : (
        <FrameCanvas
          ref={canvasRef}
          photo={photo}
          productDetail={productDetail}
          options={options}
        />
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
          disabled={!photo || !variantId || confirming}
          onClick={addCurrentToCart}
        >
          {confirming ? '담는 중…' : '장바구니 담기'}
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

/**
 * Empty-state for the studio: invites the user to upload a photo.
 *
 * Nike-aligned (DESIGN-nike.md): left-aligned typography on a 1px hairline
 * surface, no decorative chrome, pill CTA. The pre-upload tip wording mirrors
 * frame_skills.md §4.3 — fit-cover happens automatically on load.
 */
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
    <div className="border border-hairline p-6 md:p-8 flex flex-col gap-3 items-start">
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
