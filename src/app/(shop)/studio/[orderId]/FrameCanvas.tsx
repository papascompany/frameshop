'use client';

/**
 * Konva-based frame editor canvas.
 *
 * Imported via `dynamic(..., { ssr: false })` from StudioClient so Konva
 * never lands in the server bundle (editor.md AC-1/AC-12, ADR-015).
 *
 * Composition pattern (frame_skills.md §4):
 *   Stage (aspect = current variant width_mm:height_mm, clamped to 720px long edge)
 *   └ Layer (single)
 *      ├ Group clipFunc=innerRectPx   ← photo only renders inside inner_rect
 *      │   └ KonvaImage photo (draggable, scale, rotation pivot = photo center)
 *      └ KonvaImage frame PNG (stretched to Stage size, listening=false)
 *
 * Triggers for fit-cover re-layout (frame_skills.md §4.4-§4.5):
 *  - photo first load → reset rotation, fit-cover center
 *  - size change      → re-center on new innerRect, clamp scale to new fit-cover
 *  - color change     → keep cropTransform, clamp scale only (PNG src swap)
 *
 * Phase 1: simple drag clamp (photo center confined inside inner_rect).
 * Phase 2 OOS: pinch/rotate gestures, matte layer, accurate fit-cover invariant
 * under rotation, undo/redo (see editor.md OOS).
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Group, Image as KonvaImage, Layer, Rect, Stage } from 'react-konva';
import { useEditorStore } from '@/store/editor';
import {
  clamp,
  fitPhotoToFrame,
} from '@/lib/editor/transform';
import {
  CROP_SCALE_MAX,
  CROP_SCALE_MIN,
} from '@/types/editor';
import type {
  FrameAsset,
  InnerRect,
  OptionMatrix,
  ProductDetail,
  ProductVariant,
} from '@/types/product';
import type { Photo } from '@/types/photo';

// ---------- Stage sizing ----------

/** Max long-edge of the preview Stage in CSS pixels (mobile-safe, frame_skills.md §6.2). */
const STAGE_MAX_LONG_EDGE_PX = 720;

/** Compute Stage size from variant aspect, clamped to the max long edge. */
function stageSizeForVariant(variant: ProductVariant | null): { w: number; h: number } {
  // Fallback square when no variant yet (pre-init).
  if (!variant || variant.widthMm <= 0 || variant.heightMm <= 0) {
    return { w: STAGE_MAX_LONG_EDGE_PX, h: STAGE_MAX_LONG_EDGE_PX };
  }
  const ratio = variant.widthMm / variant.heightMm;
  if (ratio >= 1) {
    return { w: STAGE_MAX_LONG_EDGE_PX, h: Math.round(STAGE_MAX_LONG_EDGE_PX / ratio) };
  }
  return { w: Math.round(STAGE_MAX_LONG_EDGE_PX * ratio), h: STAGE_MAX_LONG_EDGE_PX };
}

/** Convert normalized 0..1 inner_rect to Stage pixel rect. */
function innerRectToPx(
  rect: InnerRect,
  stage: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  return {
    x: rect.x * stage.w,
    y: rect.y * stage.h,
    w: rect.w * stage.w,
    h: rect.h * stage.h,
  };
}

// ---------- Image loader ----------

function useImageBitmap(src: string): HTMLImageElement | null {
  // Track state keyed by the src so that swapping to a new (or empty) src
  // immediately invalidates the previous bitmap WITHOUT setState inside the
  // effect (avoids the react-hooks/set-state-in-effect lint).
  const [entry, setEntry] = useState<{ src: string; img: HTMLImageElement | null }>(
    { src: '', img: null },
  );
  useEffect(() => {
    if (!src) return;
    const i = new globalThis.Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setEntry({ src, img: i });
    i.onerror = () => setEntry({ src, img: null });
    i.src = src;
    return () => {
      // Best-effort GC: unbind handlers and release src so the bitmap can be
      // reclaimed when the component unmounts (frame_skills.md §6.2).
      i.onload = null;
      i.onerror = null;
      i.src = '';
    };
  }, [src]);
  // Render-time invalidation: when the requested src differs from the loaded
  // entry, return null so the canvas doesn't show a stale bitmap.
  return entry.src === src ? entry.img : null;
}

// ---------- Imperative handle for preview export ----------

export type FrameCanvasHandle = {
  /** Stage.toDataURL at retina pixelRatio, for cart preview upload (editor.md AC-9). */
  toDataURL: (opts?: { pixelRatio?: number; mimeType?: string }) => string | null;
  /** Stage CSS size — required by the print render pipeline (frame_skills.md §5.2). */
  getStageSize: () => { w: number; h: number };
};

// ---------- Component ----------

type Props = {
  photo: Photo;
  productDetail: ProductDetail;
  options: OptionMatrix;
};

const FrameCanvas = forwardRef<FrameCanvasHandle, Props>(function FrameCanvas(
  { photo, productDetail, options },
  ref,
) {
  const selectedColor = useEditorStore((s) => s.selectedOptions.colorCode);
  const selectedVariantId = useEditorStore((s) => s.selectedVariantId);
  const cropTransform = useEditorStore((s) => s.cropTransform);
  const setCropTransform = useEditorStore((s) => s.setCropTransform);

  const stageRef = useRef<Konva.Stage | null>(null);

  // ----- Resolve current frame asset (by selectedColor) -----
  const frame: FrameAsset | null = useMemo(
    () =>
      productDetail.frames.find((f) => f.colorCode === selectedColor) ??
      productDetail.frames[0] ??
      null,
    [productDetail.frames, selectedColor],
  );

  // ----- Resolve current variant (for Stage aspect ratio) -----
  const variant: ProductVariant | null = useMemo(() => {
    if (!selectedVariantId) return null;
    return (
      Object.values(options.variantsByKey).find((v) => v.id === selectedVariantId) ?? null
    );
  }, [options.variantsByKey, selectedVariantId]);

  // ----- Compute Stage size + innerRect pixels -----
  const stageSize = useMemo(() => stageSizeForVariant(variant), [variant]);
  const innerRectPx = useMemo(
    () => (frame ? innerRectToPx(frame.innerRect, stageSize) : null),
    [frame, stageSize],
  );

  // ----- Load images -----
  const photoImg = useImageBitmap(photo.originalUrl);
  const frameImg = useImageBitmap(frame?.pngUrl ?? '');

  // ----- Preview guide line (1.5s fade after first paint) -----
  // Hint to the user where the actual print area is. We deliberately only
  // run the fade on mount — re-showing it on every size/color change would
  // be visually noisy. Caption below the canvas continues to communicate it.
  const [guideVisible, setGuideVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setGuideVisible(false), 1500);
    return () => clearTimeout(t);
  }, []);

  // ----- Imperative API for parent (preview export, print render input) -----
  useImperativeHandle(
    ref,
    () => ({
      toDataURL: (opts) =>
        stageRef.current?.toDataURL({
          pixelRatio: opts?.pixelRatio ?? 2,
          mimeType: opts?.mimeType ?? 'image/png',
        }) ?? null,
      getStageSize: () => stageSize,
    }),
    [stageSize],
  );

  // ----- Trigger A: photo first loads or photo changes → reset to fit-cover -----
  const photoIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!photoImg || !frame) return;
    if (photoIdRef.current === photo.id) return;
    photoIdRef.current = photo.id;
    const t = fitPhotoToFrame(
      { w: photoImg.naturalWidth, h: photoImg.naturalHeight },
      frame.innerRect,
      stageSize,
    );
    setCropTransform(t);
  }, [photoImg, frame, photo.id, stageSize, setCropTransform]);

  // ----- Trigger B: variant change (size) → re-center on new innerRect, clamp scale -----
  const lastVariantIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!photoImg || !frame || !variant) return;
    if (lastVariantIdRef.current === variant.id) return;
    const previous = lastVariantIdRef.current;
    lastVariantIdRef.current = variant.id;
    // Skip the very first run (variant binds AFTER mount; photo load handler covers initial fit).
    if (previous === null) return;
    const r = innerRectToPx(frame.innerRect, stageSize);
    const fitCover = Math.max(
      r.w / photoImg.naturalWidth,
      r.h / photoImg.naturalHeight,
    );
    // Re-center the photo on the new innerRect center; clamp scale upward to fit-cover.
    setCropTransform({
      x: r.x + r.w / 2,
      y: r.y + r.h / 2,
      scale: clamp(
        Math.max(cropTransform.scale, fitCover),
        CROP_SCALE_MIN,
        CROP_SCALE_MAX,
      ),
      rotation: cropTransform.rotation,
    });
    // We intentionally only depend on variant.id (and the supporting photo/frame refs)
    // to avoid re-running on every cropTransform tick from drag events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.id, photoImg, frame?.id, stageSize.w, stageSize.h]);

  // ----- Trigger C: frame (color) change → preserve cropTransform, clamp scale only -----
  const lastFrameIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!photoImg || !frame) return;
    if (lastFrameIdRef.current === frame.id) return;
    const previous = lastFrameIdRef.current;
    lastFrameIdRef.current = frame.id;
    if (previous === null) return;
    const r = innerRectToPx(frame.innerRect, stageSize);
    const fitCover = Math.max(
      r.w / photoImg.naturalWidth,
      r.h / photoImg.naturalHeight,
    );
    if (cropTransform.scale < fitCover) {
      setCropTransform({
        ...cropTransform,
        scale: clamp(fitCover, CROP_SCALE_MIN, CROP_SCALE_MAX),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.id, photoImg, stageSize.w, stageSize.h]);

  if (!frame || !innerRectPx) {
    return (
      <div className="w-full aspect-square bg-soft-cloud grid place-items-center text-sm text-mute">
        액자 정보를 불러올 수 없습니다.
      </div>
    );
  }

  // Drag clamp: keep photo center inside innerRect (frame_skills.md §A.5 Phase 1 simplification).
  function clampToInnerRect(p: { x: number; y: number }): { x: number; y: number } {
    if (!innerRectPx) return p;
    return {
      x: clamp(p.x, innerRectPx.x, innerRectPx.x + innerRectPx.w),
      y: clamp(p.y, innerRectPx.y, innerRectPx.y + innerRectPx.h),
    };
  }

  // CSS-bound stage container — preserves aspect ratio on small viewports.
  return (
    <div className="w-full flex flex-col items-center">
      <div
        className="bg-soft-cloud overflow-hidden"
        style={{
          // Hard max in CSS px; on narrow viewports rely on CSS to scale down via container width.
          width: `min(100%, ${stageSize.w}px)`,
          aspectRatio: `${stageSize.w} / ${stageSize.h}`,
        }}
      >
        <Stage
          ref={stageRef}
          width={stageSize.w}
          height={stageSize.h}
          className="block max-w-full h-auto"
          style={{ width: '100%', height: '100%' }}
        >
          <Layer>
            {/* ---- Photo (clipped to inner_rect) ---- */}
            {photoImg ? (
              <Group
                clipFunc={(ctx) => {
                  if (!innerRectPx) return;
                  ctx.beginPath();
                  ctx.rect(innerRectPx.x, innerRectPx.y, innerRectPx.w, innerRectPx.h);
                  ctx.closePath();
                }}
              >
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
                  perfectDrawEnabled={false}
                  dragBoundFunc={(pos) => clampToInnerRect(pos as { x: number; y: number })}
                  onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                    const p = clampToInnerRect({ x: e.target.x(), y: e.target.y() });
                    setCropTransform({
                      ...cropTransform,
                      x: p.x,
                      y: p.y,
                    });
                  }}
                />
              </Group>
            ) : null}

            {/* ---- Frame PNG overlay ---- */}
            {frameImg ? (
              <KonvaImage
                image={frameImg}
                x={0}
                y={0}
                width={stageSize.w}
                height={stageSize.h}
                listening={false}
                perfectDrawEnabled={false}
              />
            ) : null}

            {/* ---- Print-area guide (fades after 1.5s, hint only) ---- */}
            {guideVisible && innerRectPx ? (
              <Rect
                x={innerRectPx.x}
                y={innerRectPx.y}
                width={innerRectPx.w}
                height={innerRectPx.h}
                stroke="rgba(255, 220, 60, 0.95)"
                strokeWidth={2}
                dash={[8, 6]}
                listening={false}
              />
            ) : null}
          </Layer>
        </Stage>
      </div>
      <p className="mt-3 caption-md text-mute text-center">
        사진을 드래그해 위치를 조정하세요. 점선 영역만 인쇄됩니다.
      </p>
    </div>
  );
});

export default FrameCanvas;
