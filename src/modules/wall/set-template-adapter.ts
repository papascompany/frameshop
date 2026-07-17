/**
 * SetTemplate slots → WallCanvas PlacedWallItem 변환 (FS-X-03, 읽기전용 어댑터).
 *
 * 어드민 세트 템플릿 빌더의 미니맵 프리뷰 전용 — Konva import 없음(순수 계산).
 * Konva 렌더는 같은 폴더의 SetTemplatePreview.tsx 가 담당한다(ADR-015).
 * WallCanvas 본체는 무수정: 이 어댑터가 WallCanvas 의 기존 입력 계약
 * (PlacedWallItem + wall cm)으로 변환해서 먹인다.
 *
 * 좌표 계약: SetTemplateSlot.slotPos 는 벽 좌상단 원점 mm (SlotPosMm) —
 * PlacedWallItem 의 xMm/yMm 관례와 동일하므로 값 변환 없이 클램프만 한다.
 */

import { clampToWall, orientedSizeMm } from '@/lib/wall/scale';
import type { PlacedWallItem } from '@/lib/wall/storage';
import type { SetTemplateSlot } from '@/types/set';

// ---------- Inputs ----------

/** 옵션 매트릭스(variants)에서 뽑은 sizeCode 별 대표 정보. */
export type SlotSizeInfo = {
  sizeCode: string;
  sizeLabel: string;
  widthMm: number;
  heightMm: number;
  /** 대표 variant id (프리뷰 식별용 — 가격/주문에는 쓰지 않는다). */
  variantId: string;
};

/** 대표 프레임 자산(첫 번째 색상). null → WallCanvas 가 placeholder 사각형을 그린다. */
export type SlotFrameInfo = {
  frameUrl: string;
  colorCode: string;
  colorLabel: string;
};

export type SetTemplatePreviewInput = {
  productId: string;
  slots: SetTemplateSlot[];
  /** 벽모드 치수(mm). null = 그리드모드 → 합성 벽에 일렬 배치. */
  wallWMm: number | null;
  wallHMm: number | null;
  sizes: SlotSizeInfo[];
  frame: SlotFrameInfo | null;
};

export type SetTemplatePreviewModel = {
  wallWidthCm: number;
  wallHeightCm: number;
  items: PlacedWallItem[];
};

// ---------- Grid-mode synthetic wall ----------

/** 그리드모드 일렬 배치 간격/여백 (mm). */
const GRID_GAP_MM = 50;
const GRID_MARGIN_MM = 100;

// ---------- Conversion ----------

/**
 * slots → WallCanvas 입력. 규칙:
 *  - sizeCode 가 옵션 매트릭스에 없으면 해당 슬롯은 건너뛴다(판매 불가 조합).
 *  - 실측: slotPos 有 → slotPos.wMm/hMm(어드민 명시값), 無 → variant mm 를
 *    orientation 에 맞춰 회전(orientedSizeMm — 에디터/포토월과 동일 관례).
 *  - 위치: slotPos 有 → (xMm,yMm) 를 벽 안으로 클램프, 無(그리드모드) →
 *    좌→우 일렬 배치.
 *  - 벽: wallWMm/wallHMm 가 없으면(그리드모드) 아이템 크기로 합성한다.
 */
export function buildSetTemplatePreview(
  input: SetTemplatePreviewInput,
): SetTemplatePreviewModel {
  const sizeByCode = new Map(input.sizes.map((s) => [s.sizeCode, s]));

  type Prepared = {
    slot: SetTemplateSlot;
    size: SlotSizeInfo;
    wMm: number;
    hMm: number;
  };

  const prepared: Prepared[] = [];
  for (const slot of input.slots) {
    const size = sizeByCode.get(slot.sizeCode);
    if (!size) continue; // 매트릭스에 없는 사이즈 — 프리뷰에서 제외.
    const oriented = orientedSizeMm(size.widthMm, size.heightMm, slot.orientation);
    prepared.push({
      slot,
      size,
      wMm: slot.slotPos?.wMm ?? oriented.wMm,
      hMm: slot.slotPos?.hMm ?? oriented.hMm,
    });
  }

  // 벽 치수: 벽모드 = 저장값, 그리드모드 = 아이템 실측 합으로 합성.
  const isWallMode = input.wallWMm != null && input.wallHMm != null;
  const wallWMm = isWallMode
    ? (input.wallWMm as number)
    : prepared.reduce((acc, p) => acc + p.wMm, 0) +
      GRID_GAP_MM * Math.max(0, prepared.length - 1) +
      GRID_MARGIN_MM * 2;
  const wallHMm = isWallMode
    ? (input.wallHMm as number)
    : Math.max(0, ...prepared.map((p) => p.hMm)) + GRID_MARGIN_MM * 2;

  const wall = { wMm: wallWMm, hMm: wallHMm };

  let cursorXMm = GRID_MARGIN_MM;
  const items: PlacedWallItem[] = prepared.map((p) => {
    let xMm: number;
    let yMm: number;
    if (p.slot.slotPos) {
      const clamped = clampToWall(
        { xMm: p.slot.slotPos.xMm, yMm: p.slot.slotPos.yMm },
        { wMm: p.wMm, hMm: p.hMm },
        wall,
      );
      xMm = clamped.xMm;
      yMm = clamped.yMm;
    } else {
      // 그리드모드: 좌→우 일렬, 수직 가운데.
      xMm = cursorXMm;
      yMm = Math.max(0, (wallHMm - p.hMm) / 2);
      cursorXMm += p.wMm + GRID_GAP_MM;
    }
    return {
      id: `slot-${p.slot.slotIndex}`,
      productId: input.productId,
      variantId: p.size.variantId,
      sizeCode: p.size.sizeCode,
      sizeLabel: p.size.sizeLabel,
      wMm: p.wMm,
      hMm: p.hMm,
      orientation: p.slot.orientation,
      colorCode: input.frame?.colorCode ?? 'preview',
      colorLabel: input.frame?.colorLabel ?? '미리보기',
      // 빈 문자열이면 WallCanvas 의 useImageBitmap 이 로드를 건너뛰고
      // placeholder 사각형(실측 유지)을 그린다 — graceful.
      frameUrl: input.frame?.frameUrl ?? '',
      xMm,
      yMm,
      price: 0,
    };
  });

  // WallCanvas 는 cm 단위 입력(내부에서 cmToMm) — mm/10.
  return {
    wallWidthCm: wallWMm / 10,
    wallHeightCm: wallHMm / 10,
    items,
  };
}
