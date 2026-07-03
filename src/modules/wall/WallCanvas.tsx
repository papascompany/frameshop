'use client';

/**
 * Photo-wall simulator canvas (FS-EC-04).
 *
 * Konva lives ONLY here (ADR-015) — WallClient loads this module via
 * `dynamic(..., { ssr: false })` so Konva never enters the server bundle.
 *
 * True-scale rendering: a SINGLE scale factor `s` (px per mm) sizes both the
 * wall and every frame, so relative proportions are physically accurate.
 * `s = min(containerWidth / wallWidthMm, MAX_STAGE_HEIGHT / wallHeightMm)`
 * — width-fit first (mobile 375px full-width), capped by height so a tall
 * wall doesn't produce an endless canvas.
 *
 * Layers (back → front):
 *   1. Wall background + hanging guides (centre line, eye-level 145 cm) —
 *      listening={false}
 *   2. Placed frames — draggable Groups (Konva drag = touch-ready), clamped
 *      to the wall via dragBoundFunc; commit mm coords on dragEnd
 */

import { useEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { cmToMm, eyeLevelYMm } from '@/lib/wall/scale';
import type { PlacedWallItem } from '@/lib/wall/storage';

/** Height cap so extreme walls (e.g. 100×1000 cm) stay scrollable-free. */
const MAX_STAGE_HEIGHT_PX = 560;

const WALL_FILL = '#f6f4f0';
const WALL_STROKE = '#d9d4cc';
const GUIDE_STROKE = 'rgba(17, 17, 17, 0.28)';
const EYE_LEVEL_STROKE = 'rgba(217, 119, 6, 0.75)'; // amber-600
const SELECT_STROKE = '#111111';
const LABEL_FILL = '#6b7280';

// ---------- Image loader (crossOrigin anonymous — FrameCanvas pattern) ----------

function useImageBitmap(src: string): HTMLImageElement | null {
  const [entry, setEntry] = useState<{ src: string; img: HTMLImageElement | null }>({
    src: '',
    img: null,
  });
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

// ---------- Placed frame node ----------

type WallItemNodeProps = {
  item: PlacedWallItem;
  s: number;
  wallWPx: number;
  wallHPx: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, xMm: number, yMm: number) => void;
};

function WallItemNode({
  item,
  s,
  wallWPx,
  wallHPx,
  isSelected,
  onSelect,
  onMove,
}: WallItemNodeProps) {
  const img = useImageBitmap(item.frameUrl);
  const wPx = item.wMm * s;
  const hPx = item.hMm * s;
  const maxX = Math.max(0, wallWPx - wPx);
  const maxY = Math.max(0, wallHPx - hPx);

  function handleDragEnd(e: KonvaEventObject<DragEvent>): void {
    onMove(item.id, e.target.x() / s, e.target.y() / s);
  }

  return (
    <Group
      x={item.xMm * s}
      y={item.yMm * s}
      draggable
      onClick={() => onSelect(item.id)}
      onTap={() => onSelect(item.id)}
      onDragStart={() => onSelect(item.id)}
      onDragEnd={handleDragEnd}
      dragBoundFunc={(pos) => ({
        x: Math.min(Math.max(pos.x, 0), maxX),
        y: Math.min(Math.max(pos.y, 0), maxY),
      })}
    >
      {img ? (
        <KonvaImage
          image={img}
          width={wPx}
          height={hPx}
          perfectDrawEnabled={false}
          shadowColor="rgba(0,0,0,0.35)"
          shadowBlur={6}
          shadowOffsetY={3}
        />
      ) : (
        // PNG not loaded (yet / CORS failure) — placeholder keeps the true
        // physical footprint so layout judgement still works (graceful).
        <Rect
          width={wPx}
          height={hPx}
          fill="#e5e1da"
          stroke="#b9b2a6"
          strokeWidth={1}
        />
      )}
      {isSelected ? (
        <>
          <Rect
            width={wPx}
            height={hPx}
            stroke={SELECT_STROKE}
            strokeWidth={2}
            dash={[8, 5]}
            listening={false}
          />
          <Text
            y={hPx + 4}
            width={Math.max(wPx, 72)}
            text={`${item.sizeLabel} · ${item.colorLabel}`}
            fontSize={11}
            fill={SELECT_STROKE}
            align="left"
            listening={false}
          />
        </>
      ) : null}
    </Group>
  );
}

// ---------- Canvas ----------

export type WallCanvasProps = {
  wallWidthCm: number;
  wallHeightCm: number;
  items: PlacedWallItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, xMm: number, yMm: number) => void;
};

export default function WallCanvas({
  wallWidthCm,
  wallHeightCm,
  items,
  selectedId,
  onSelect,
  onMove,
}: WallCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);

  // Responsive: track the container width (mobile full-width first, ADR-002).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wallWMm = cmToMm(wallWidthCm);
  const wallHMm = cmToMm(wallHeightCm);

  // SINGLE scale factor for wall + frames (비율 왜곡 금지).
  const s =
    containerW > 0 && wallWMm > 0 && wallHMm > 0
      ? Math.min(containerW / wallWMm, MAX_STAGE_HEIGHT_PX / wallHMm)
      : 0;
  const wallWPx = wallWMm * s;
  const wallHPx = wallHMm * s;

  const eyeYMm = eyeLevelYMm(wallHMm);

  function handleStagePointerDown(
    e: KonvaEventObject<MouseEvent> | KonvaEventObject<TouchEvent>,
  ): void {
    // Tap/click on the empty wall (stage itself or a non-listening bg shape
    // bubbles to the stage) → deselect.
    if (e.target === e.target.getStage()) onSelect(null);
  }

  return (
    <div ref={containerRef} className="w-full" data-testid="wall-canvas">
      {s > 0 ? (
        <div className="mx-auto" style={{ width: wallWPx, height: wallHPx }}>
          <Stage
            width={wallWPx}
            height={wallHPx}
            onMouseDown={handleStagePointerDown}
            onTouchStart={handleStagePointerDown}
          >
            {/* ---- Wall background + hanging guides ---- */}
            <Layer listening={false}>
              <Rect
                width={wallWPx}
                height={wallHPx}
                fill={WALL_FILL}
                stroke={WALL_STROKE}
                strokeWidth={1}
              />
              {/* Centre (vertical) hanging guide */}
              <Line
                points={[wallWPx / 2, 0, wallWPx / 2, wallHPx]}
                stroke={GUIDE_STROKE}
                strokeWidth={1}
                dash={[6, 6]}
              />
              {/* Eye-level 145 cm guide (from the floor) */}
              {eyeYMm !== null ? (
                <>
                  <Line
                    points={[0, eyeYMm * s, wallWPx, eyeYMm * s]}
                    stroke={EYE_LEVEL_STROKE}
                    strokeWidth={1}
                    dash={[10, 6]}
                  />
                  <Text
                    x={6}
                    y={eyeYMm * s - 16}
                    text="눈높이 145cm"
                    fontSize={11}
                    fill={EYE_LEVEL_STROKE}
                  />
                </>
              ) : null}
              {/* Wall dimension labels */}
              <Text
                x={0}
                y={6}
                width={wallWPx}
                align="center"
                text={`${wallWidthCm}cm`}
                fontSize={11}
                fill={LABEL_FILL}
              />
              <Text
                x={8}
                y={wallHPx / 2}
                text={`${wallHeightCm}cm`}
                fontSize={11}
                fill={LABEL_FILL}
                rotation={-90}
              />
            </Layer>

            {/* ---- Placed frames (z-order = 추가순) ---- */}
            <Layer>
              {items.map((item) => (
                <WallItemNode
                  key={item.id}
                  item={item}
                  s={s}
                  wallWPx={wallWPx}
                  wallHPx={wallHPx}
                  isSelected={item.id === selectedId}
                  onSelect={onSelect}
                  onMove={onMove}
                />
              ))}
            </Layer>
          </Stage>
        </div>
      ) : (
        <div className="w-full aspect-[3/2] bg-soft-cloud grid place-items-center text-sm text-mute">
          벽을 준비하는 중…
        </div>
      )}
    </div>
  );
}
