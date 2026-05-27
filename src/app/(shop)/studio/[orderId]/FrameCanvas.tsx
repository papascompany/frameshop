'use client';

/**
 * Konva-based frame editor canvas.
 *
 * Imported via `dynamic(..., { ssr: false })` from StudioClient so Konva
 * never lands in the server bundle (editor.md AC-1/AC-12, ADR-015).
 *
 * Composition pattern (Canva-style):
 *   Stage (aspect = current variant width_mm:height_mm, clamped to 720px long edge)
 *   └ Layer
 *      ├ KonvaImage photo (draggable / scalable / rotatable, no clip)
 *      ├ Rect × 4 dim-mask outside inner_rect (so photo is visible but dimmed)
 *      ├ KonvaImage frame PNG (stretched to Stage size, listening=false)
 *      └ Transformer attached to photo (8 corner/side anchors + rotate handle)
 *
 * UX:
 *   - Photo is selected by default → handles always visible (no extra click).
 *   - User can freely drag, scale, rotate via the handles or by dragging
 *     the photo body. Areas of the photo outside the print region are
 *     dimmed (50 % black) so the user understands what will be cropped.
 *
 * Triggers for fit-cover re-layout:
 *  - photo first load → reset rotation, fit-cover center
 *  - size change      → re-center on new innerRect, clamp scale to new fit-cover
 *  - color change     → keep cropTransform, clamp scale only (PNG src swap)
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Transformer } from 'react-konva';
import { useEditorStore } from '@/store/editor';
import {
  clamp,
  fitPhotoToFrame,
} from '@/lib/editor/transform';
import {
  CROP_ROTATION_MAX_DEG,
  CROP_ROTATION_MIN_DEG,
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

/** Anchor square edge length — large enough for comfortable touch (~24px). */
const ANCHOR_SIZE_PX = 14;
const ANCHOR_STROKE_PX = 1.5;
const ROTATE_ANCHOR_OFFSET_PX = 28;

/** Dim mask opacity for areas outside the print region. */
const DIM_FILL = 'rgba(0, 0, 0, 0.55)';

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
  const photoNodeRef = useRef<Konva.Image | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);

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
  const [guideVisible, setGuideVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setGuideVisible(false), 1500);
    return () => clearTimeout(t);
  }, []);

  // ----- Imperative API for parent (preview export, print render input) -----
  useImperativeHandle(
    ref,
    () => ({
      toDataURL: (opts) => {
        // Hide the transformer/guide for the snapshot so they don't bleed
        // into the cart preview.
        const tr = transformerRef.current;
        const previousVisible = tr?.visible() ?? true;
        if (tr) tr.visible(false);
        const url = stageRef.current?.toDataURL({
          pixelRatio: opts?.pixelRatio ?? 2,
          mimeType: opts?.mimeType ?? 'image/png',
        }) ?? null;
        if (tr) tr.visible(previousVisible);
        return url;
      },
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
    if (previous === null) return;
    const r = innerRectToPx(frame.innerRect, stageSize);
    const fitCover = Math.max(
      r.w / photoImg.naturalWidth,
      r.h / photoImg.naturalHeight,
    );
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

  // ----- Attach the Transformer to the photo node whenever the photo is ready -----
  useEffect(() => {
    const tr = transformerRef.current;
    const node = photoNodeRef.current;
    if (!tr || !node || !photoImg) {
      tr?.nodes([]);
      return;
    }
    tr.nodes([node]);
    tr.getLayer()?.batchDraw();
  }, [photoImg, frame?.id]);

  if (!frame || !innerRectPx) {
    return (
      <div className="w-full aspect-square bg-soft-cloud grid place-items-center text-sm text-mute">
        액자 정보를 불러올 수 없습니다.
      </div>
    );
  }

  /**
   * Konva Transformer drives scale via scaleX/scaleY. We commit changes to
   * the store at the end of each interaction (drag / scale / rotate).
   * Uniform scale is enforced by only enabling corner anchors.
   */
  function commitTransformFromNode(): void {
    const node = photoNodeRef.current;
    if (!node) return;
    const rawScale = node.scaleX();
    const scale = clamp(rawScale, CROP_SCALE_MIN, CROP_SCALE_MAX);
    const rawRotation = node.rotation();
    const rotation = clamp(
      rawRotation,
      CROP_ROTATION_MIN_DEG,
      CROP_ROTATION_MAX_DEG,
    );
    setCropTransform({
      x: node.x(),
      y: node.y(),
      scale,
      rotation,
    });
  }

  return (
    <div className="w-full flex flex-col items-center">
      <div
        className="bg-soft-cloud overflow-hidden touch-none"
        style={{
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
            {/* ---- Photo (no clip — full bitmap is visible) ---- */}
            {photoImg ? (
              <KonvaImage
                ref={photoNodeRef}
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
                onDragEnd={commitTransformFromNode}
                onTransformEnd={commitTransformFromNode}
              />
            ) : null}

            {/* ---- Dim mask: 4 rects around inner_rect, so the photo is
                       visible everywhere but darkened outside the print region ---- */}
            {innerRectPx ? (
              <Group listening={false}>
                {/* top */}
                <Rect
                  x={0}
                  y={0}
                  width={stageSize.w}
                  height={innerRectPx.y}
                  fill={DIM_FILL}
                />
                {/* bottom */}
                <Rect
                  x={0}
                  y={innerRectPx.y + innerRectPx.h}
                  width={stageSize.w}
                  height={Math.max(0, stageSize.h - (innerRectPx.y + innerRectPx.h))}
                  fill={DIM_FILL}
                />
                {/* left */}
                <Rect
                  x={0}
                  y={innerRectPx.y}
                  width={innerRectPx.x}
                  height={innerRectPx.h}
                  fill={DIM_FILL}
                />
                {/* right */}
                <Rect
                  x={innerRectPx.x + innerRectPx.w}
                  y={innerRectPx.y}
                  width={Math.max(0, stageSize.w - (innerRectPx.x + innerRectPx.w))}
                  height={innerRectPx.h}
                  fill={DIM_FILL}
                />
              </Group>
            ) : null}

            {/* ---- Frame PNG overlay (gets drawn over dim mask + photo edges) ---- */}
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

            {/* ---- Transformer (8 anchors + rotate handle on the actual photo
                       outline, drawn on top of everything so handles stay grabbable) ---- */}
            {photoImg ? (
              <Transformer
                ref={transformerRef}
                rotateEnabled
                keepRatio
                ignoreStroke
                shouldOverdrawWholeArea
                enabledAnchors={[
                  'top-left',
                  'top-right',
                  'bottom-left',
                  'bottom-right',
                ]}
                anchorSize={ANCHOR_SIZE_PX}
                anchorStroke="#111"
                anchorFill="#fff"
                anchorStrokeWidth={ANCHOR_STROKE_PX}
                anchorCornerRadius={2}
                borderStroke="#111"
                borderStrokeWidth={1}
                borderDash={[4, 4]}
                rotateAnchorOffset={ROTATE_ANCHOR_OFFSET_PX}
                rotationSnaps={[0, 90, 180, 270]}
                rotationSnapTolerance={4}
                boundBoxFunc={(oldBox, newBox) => {
                  // Reject degenerate boxes to avoid Konva NaN issues.
                  if (newBox.width < 10 || newBox.height < 10) return oldBox;
                  return newBox;
                }}
              />
            ) : null}
          </Layer>
        </Stage>
      </div>
      <p className="mt-3 caption-md text-mute text-center">
        사진을 드래그·핸들로 위치/크기/회전을 조정하세요. 점선 영역만 인쇄됩니다.
      </p>
    </div>
  );
});

export default FrameCanvas;
