'use client';

/**
 * Konva-based frame editor canvas.
 *
 * Imported via `dynamic(..., { ssr: false })` from StudioClient so Konva
 * never lands in the server bundle (editor.md AC-1/AC-12).
 *
 * Phase 1 scope:
 *  - Render photo + selected frame PNG overlay at fit-cover
 *  - React to color changes (swap PNG)
 *  - Drag photo within innerRect (simple bounded move)
 * Phase 2: pinch/rotate, matte layer, undo/redo (see editor.md OOS).
 */

import { useEffect, useMemo, useState } from 'react';
import { Image as KonvaImage, Layer, Stage } from 'react-konva';
import { useEditorStore } from '@/store/editor';
import { fitPhotoToFrame } from '@/lib/editor/transform';
import type { OptionMatrix, ProductDetail } from '@/types/product';
import type { Photo } from '@/types/photo';

function useImageBitmap(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const i = new globalThis.Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.src = src;
    return () => {
      i.onload = null;
    };
  }, [src]);
  return img;
}

type Props = {
  photo: Photo;
  productDetail: ProductDetail;
  options: OptionMatrix;
};

const STAGE_SIZE = { w: 600, h: 600 };

function FrameCanvas({ photo, productDetail }: Props) {
  const selectedColor = useEditorStore((s) => s.selectedOptions.colorCode);
  const cropTransform = useEditorStore((s) => s.cropTransform);
  const setCropTransform = useEditorStore((s) => s.setCropTransform);

  const frame = useMemo(
    () =>
      productDetail.frames.find((f) => f.colorCode === selectedColor) ??
      productDetail.frames[0] ??
      null,
    [productDetail.frames, selectedColor],
  );

  const photoImg = useImageBitmap(photo.originalUrl);
  const frameImg = useImageBitmap(frame?.pngUrl ?? '');

  useEffect(() => {
    if (!photoImg || !frame) return;
    const initial = fitPhotoToFrame(
      { w: photoImg.naturalWidth, h: photoImg.naturalHeight },
      frame.innerRect,
      STAGE_SIZE,
    );
    setCropTransform(initial);
  }, [photoImg, frame, setCropTransform]);

  if (!frame) return null;

  return (
    <div className="w-full max-w-[600px] mx-auto aspect-square bg-surface-muted">
      <Stage width={STAGE_SIZE.w} height={STAGE_SIZE.h} className="block">
        <Layer>
          {photoImg ? (
            <KonvaImage
              image={photoImg}
              x={cropTransform.x}
              y={cropTransform.y}
              scaleX={cropTransform.scale}
              scaleY={cropTransform.scale}
              rotation={cropTransform.rotation}
              offsetX={photoImg.naturalWidth / 2}
              offsetY={photoImg.naturalHeight / 2}
              draggable
              onDragMove={(e) => {
                setCropTransform({
                  ...cropTransform,
                  x: e.target.x(),
                  y: e.target.y(),
                });
              }}
            />
          ) : null}
          {frameImg ? (
            <KonvaImage
              image={frameImg}
              x={0}
              y={0}
              width={STAGE_SIZE.w}
              height={STAGE_SIZE.h}
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  );
}

export default FrameCanvas;
