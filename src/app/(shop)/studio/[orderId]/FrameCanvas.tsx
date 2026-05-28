'use client';

/**
 * Konva-based frame editor canvas. Canva-style UX.
 *
 * Imported via `dynamic(..., { ssr: false })` from StudioClient so Konva
 * never lands in the server bundle (editor.md AC-1/AC-12, ADR-015).
 *
 * Stage layout (PADDING around the frame so the user can grab handles that
 * sit on the photo's outer edge):
 *
 *     ┌──────────────── Stage ────────────────┐
 *     │  pad                                  │
 *     │   ┌──── Frame (real product size) ───┐│
 *     │   │ pad                              ││
 *     │   │  ┌── inner_rect (print area) ──┐ ││
 *     │   │  │                             │ ││
 *     │   │  │  photo (selected, dim mask  │ ││
 *     │   │  │  applied OUTSIDE inner_rect)│ ││
 *     │   │  └─────────────────────────────┘ ││
 *     │   │                                  ││
 *     │   └──────────────────────────────────┘│
 *     │                                       │
 *     └───────────────────────────────────────┘
 *
 * Render order (back → front):
 *   1. Photo (no clip — bitmap is drawn in full)
 *   2. Dim mask — Stage-wide rgba(0,0,0,0.45) with the inner_rect cut out
 *      → photo OUTSIDE the print region appears translucent so the user
 *        can judge how much will be cropped
 *   3. Frame PNG (drawn only over the frame rect, NOT over the padding)
 *   4. Print-area dashed guide (always visible, brand-yellow)
 *   5. Transformer attached to the photo (8/4 anchors + rotate handle).
 *      anchors are filled BLACK with a thick WHITE stroke so they stand
 *      out against any background (photo, padding, dim mask).
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Transformer } from 'react-konva';
import { useEditorStore } from '@/store/editor';
import { clamp } from '@/lib/editor/transform';
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

/** Max long-edge of the FRAME (not the whole Stage) in CSS pixels. */
const FRAME_MAX_LONG_EDGE_PX = 560;
/** Stage = Frame size × (1 + 2 × PADDING_RATIO) so the photo can spill out. */
const STAGE_PADDING_RATIO = 0.22;

/** Anchor visuals. Black fill + thick white stroke → visible on any bg. */
const ANCHOR_SIZE_PX = 16;
const ANCHOR_STROKE_PX = 2.5;
const ROTATE_ANCHOR_OFFSET_PX = 32;

/** Dim mask opacity for areas outside the print region. */
const DIM_FILL = 'rgba(0, 0, 0, 0.45)';
/** Print-area guide colour (kept on permanently — no fade). */
const GUIDE_STROKE = 'rgba(250, 204, 21, 1)'; // tailwind yellow-400
/** Brand accent for transformer outline / handles. */
const HANDLE_FILL = '#111111';
const HANDLE_STROKE = '#ffffff';
const BORDER_STROKE = '#111111';

// ---------- Stage geometry ----------

type StageGeom = {
  /** Full Stage size in CSS pixels (includes padding). */
  w: number;
  h: number;
  /** Top-left of the frame rect inside the Stage. */
  frameX: number;
  frameY: number;
  /** Frame rect (real product aspect). */
  frameW: number;
  frameH: number;
};

function stageGeometryForVariant(variant: ProductVariant | null): StageGeom {
  // Pre-init / unknown — fall back to a square.
  if (!variant || variant.widthMm <= 0 || variant.heightMm <= 0) {
    const padX = Math.round(FRAME_MAX_LONG_EDGE_PX * STAGE_PADDING_RATIO);
    return {
      w: FRAME_MAX_LONG_EDGE_PX + 2 * padX,
      h: FRAME_MAX_LONG_EDGE_PX + 2 * padX,
      frameX: padX,
      frameY: padX,
      frameW: FRAME_MAX_LONG_EDGE_PX,
      frameH: FRAME_MAX_LONG_EDGE_PX,
    };
  }
  const ratio = variant.widthMm / variant.heightMm;
  let frameW: number;
  let frameH: number;
  if (ratio >= 1) {
    frameW = FRAME_MAX_LONG_EDGE_PX;
    frameH = Math.round(FRAME_MAX_LONG_EDGE_PX / ratio);
  } else {
    frameW = Math.round(FRAME_MAX_LONG_EDGE_PX * ratio);
    frameH = FRAME_MAX_LONG_EDGE_PX;
  }
  const padX = Math.round(frameW * STAGE_PADDING_RATIO);
  const padY = Math.round(frameH * STAGE_PADDING_RATIO);
  return {
    w: frameW + 2 * padX,
    h: frameH + 2 * padY,
    frameX: padX,
    frameY: padY,
    frameW,
    frameH,
  };
}

/** Convert normalized 0..1 inner_rect to absolute Stage pixel coords. */
function innerRectToStagePx(
  rect: InnerRect,
  stage: StageGeom,
): { x: number; y: number; w: number; h: number } {
  return {
    x: stage.frameX + rect.x * stage.frameW,
    y: stage.frameY + rect.y * stage.frameH,
    w: rect.w * stage.frameW,
    h: rect.h * stage.frameH,
  };
}

// ---------- Image loader ----------

function useImageBitmap(src: string): HTMLImageElement | null {
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
      i.onload = null;
      i.onerror = null;
      i.src = '';
    };
  }, [src]);
  return entry.src === src ? entry.img : null;
}

// ---------- Imperative handle for preview export ----------

export type FrameCanvasHandle = {
  /** Stage.toDataURL — clipped to the FRAME rect only (padding excluded). */
  toDataURL: (opts?: { pixelRatio?: number; mimeType?: string }) => string | null;
  /** Frame CSS size — required by the print render pipeline (frame_skills.md §5.2). */
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

  // ----- Load images -----
  const photoImg = useImageBitmap(photo.originalUrl);
  const frameImg = useImageBitmap(frame?.pngUrl ?? '');

  // ----- Stage geometry: starts as `frame + padding`, then EXPANDS to fit
  //       the photo's fit-cover bounding box + handle margin so that the
  //       corner anchors are always inside the Stage canvas. Konva does not
  //       draw outside the canvas pixels, so this is the only reliable way
  //       to keep handles visible across all photo/frame aspect-ratio combos. -----
  const stage = useMemo(() => {
    const base = stageGeometryForVariant(variant);
    if (!photoImg || !frame) return base;

    // inner_rect dimensions in the BASE stage coordinate system
    const innerW = frame.innerRect.w * base.frameW;
    const innerH = frame.innerRect.h * base.frameH;
    const fitCover = Math.max(
      innerW / photoImg.naturalWidth,
      innerH / photoImg.naturalHeight,
    );
    const photoOnCanvasW = photoImg.naturalWidth * fitCover;
    const photoOnCanvasH = photoImg.naturalHeight * fitCover;

    // Extra margin around the photo for anchor squares + rotate handle.
    const HANDLE_MARGIN = ANCHOR_SIZE_PX + ROTATE_ANCHOR_OFFSET_PX + 12;
    const requiredW = photoOnCanvasW + 2 * HANDLE_MARGIN;
    const requiredH = photoOnCanvasH + 2 * HANDLE_MARGIN;

    if (requiredW <= base.w && requiredH <= base.h) return base;

    const newW = Math.max(base.w, Math.ceil(requiredW));
    const newH = Math.max(base.h, Math.ceil(requiredH));
    // Frame stays centred inside the expanded Stage.
    return {
      w: newW,
      h: newH,
      frameX: Math.round((newW - base.frameW) / 2),
      frameY: Math.round((newH - base.frameH) / 2),
      frameW: base.frameW,
      frameH: base.frameH,
    };
  }, [variant, photoImg, frame]);

  const innerRectPx = useMemo(
    () => (frame ? innerRectToStagePx(frame.innerRect, stage) : null),
    [frame, stage],
  );

  // ----- Imperative API for parent (preview export, print render input) -----
  useImperativeHandle(
    ref,
    () => ({
      toDataURL: (opts) => {
        const tr = transformerRef.current;
        const wasVisible = tr?.visible() ?? true;
        if (tr) tr.visible(false);
        // Capture only the frame rect (skip the padding around it).
        const url = stageRef.current?.toDataURL({
          x: stage.frameX,
          y: stage.frameY,
          width: stage.frameW,
          height: stage.frameH,
          pixelRatio: opts?.pixelRatio ?? 2,
          mimeType: opts?.mimeType ?? 'image/png',
        }) ?? null;
        if (tr) tr.visible(wasVisible);
        return url;
      },
      getStageSize: () => ({ w: stage.frameW, h: stage.frameH }),
    }),
    [stage],
  );

  // ----- Trigger A: photo first loads or photo changes → reset to fit-cover -----
  const photoIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!photoImg || !frame) return;
    if (photoIdRef.current === photo.id) return;
    photoIdRef.current = photo.id;
    const r = innerRectToStagePx(frame.innerRect, stage);
    const fitCover = Math.max(
      r.w / photoImg.naturalWidth,
      r.h / photoImg.naturalHeight,
    );
    setCropTransform({
      x: r.x + r.w / 2,
      y: r.y + r.h / 2,
      scale: clamp(fitCover, CROP_SCALE_MIN, CROP_SCALE_MAX),
      rotation: 0,
    });
  }, [photoImg, frame, photo.id, stage, setCropTransform]);

  // ----- Trigger B: variant change (size) → re-center on new innerRect, clamp scale -----
  const lastVariantIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!photoImg || !frame || !variant) return;
    if (lastVariantIdRef.current === variant.id) return;
    const previous = lastVariantIdRef.current;
    lastVariantIdRef.current = variant.id;
    if (previous === null) return;
    const r = innerRectToStagePx(frame.innerRect, stage);
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
  }, [variant?.id, photoImg, frame?.id, stage.w, stage.h]);

  // ----- Trigger C: frame (color) change → preserve cropTransform, clamp scale only -----
  const lastFrameIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!photoImg || !frame) return;
    if (lastFrameIdRef.current === frame.id) return;
    const previous = lastFrameIdRef.current;
    lastFrameIdRef.current = frame.id;
    if (previous === null) return;
    const r = innerRectToStagePx(frame.innerRect, stage);
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
  }, [frame?.id, photoImg, stage.w, stage.h]);

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
   * Uniform scale is enforced by only enabling corner anchors with keepRatio.
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
          width: `min(100%, ${stage.w}px)`,
          aspectRatio: `${stage.w} / ${stage.h}`,
        }}
      >
        <Stage
          ref={stageRef}
          width={stage.w}
          height={stage.h}
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

            {/* ---- Dim mask: 4 rects covering the Stage *except* inner_rect.
                       Photo OUTSIDE the print area becomes translucent so
                       the user can judge what will be cropped. ---- */}
            {innerRectPx ? (
              <Group listening={false}>
                {/* top — from Stage top to top edge of inner_rect */}
                <Rect
                  x={0}
                  y={0}
                  width={stage.w}
                  height={innerRectPx.y}
                  fill={DIM_FILL}
                />
                {/* bottom */}
                <Rect
                  x={0}
                  y={innerRectPx.y + innerRectPx.h}
                  width={stage.w}
                  height={Math.max(0, stage.h - (innerRectPx.y + innerRectPx.h))}
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
                  width={Math.max(0, stage.w - (innerRectPx.x + innerRectPx.w))}
                  height={innerRectPx.h}
                  fill={DIM_FILL}
                />
              </Group>
            ) : null}

            {/* ---- Frame PNG overlay — drawn only over the frame rect ---- */}
            {frameImg ? (
              <KonvaImage
                image={frameImg}
                x={stage.frameX}
                y={stage.frameY}
                width={stage.frameW}
                height={stage.frameH}
                listening={false}
                perfectDrawEnabled={false}
              />
            ) : null}

            {/* ---- Print-area guide — black outline + yellow dashed line so
                       it stays visible on any photo colour ---- */}
            {innerRectPx ? (
              <Group listening={false}>
                {/* Black backdrop — solid, thicker, drawn first */}
                <Rect
                  x={innerRectPx.x}
                  y={innerRectPx.y}
                  width={innerRectPx.w}
                  height={innerRectPx.h}
                  stroke="rgba(0, 0, 0, 0.85)"
                  strokeWidth={4}
                />
                {/* Yellow dashed line on top */}
                <Rect
                  x={innerRectPx.x}
                  y={innerRectPx.y}
                  width={innerRectPx.w}
                  height={innerRectPx.h}
                  stroke={GUIDE_STROKE}
                  strokeWidth={2}
                  dash={[10, 6]}
                />
              </Group>
            ) : null}

            {/* ---- Transformer (anchors + rotate handle on photo outline,
                       drawn on top so handles stay grabbable). ---- */}
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
                anchorStroke={HANDLE_STROKE}
                anchorFill={HANDLE_FILL}
                anchorStrokeWidth={ANCHOR_STROKE_PX}
                anchorCornerRadius={3}
                borderStroke={BORDER_STROKE}
                borderStrokeWidth={1.5}
                borderDash={[6, 4]}
                rotateAnchorOffset={ROTATE_ANCHOR_OFFSET_PX}
                rotationSnaps={[0, 90, 180, 270]}
                rotationSnapTolerance={4}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 10 || newBox.height < 10) return oldBox;
                  return newBox;
                }}
              />
            ) : null}
          </Layer>
        </Stage>
      </div>
      <p className="mt-3 caption-md text-mute text-center">
        사진을 드래그·핸들로 위치/크기/회전을 조정하세요. 노란 점선 영역만 인쇄됩니다.
      </p>
    </div>
  );
});

export default FrameCanvas;
