'use client';

/**
 * 세트 템플릿 읽기전용 미니맵 프리뷰 (FS-X-03).
 *
 * WallCanvas(Konva) 를 그대로 재사용하되(본체 무수정):
 *  - 어댑터(set-template-adapter)로 slots → PlacedWallItem 변환
 *  - `pointer-events-none` 래퍼로 드래그/선택을 차단(읽기전용)
 *
 * Konva 규칙(ADR-015): 이 모듈은 반드시 `dynamic(..., { ssr: false })` 로만
 * 마운트한다 — WorkspaceClient 참조.
 */

import WallCanvas from './WallCanvas';
import {
  buildSetTemplatePreview,
  type SetTemplatePreviewInput,
} from './set-template-adapter';

const NOOP_SELECT = (): void => undefined;
const NOOP_MOVE = (): void => undefined;

export default function SetTemplatePreview(props: SetTemplatePreviewInput) {
  const model = buildSetTemplatePreview(props);

  if (model.items.length === 0) {
    return (
      <div className="w-full aspect-[3/2] bg-surface-muted border border-border grid place-items-center text-sm text-muted-fg">
        표시할 슬롯이 없습니다 — 슬롯을 추가하면 미리보기가 나타납니다.
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none select-none"
      aria-hidden
      data-testid="set-template-preview"
    >
      <WallCanvas
        wallWidthCm={model.wallWidthCm}
        wallHeightCm={model.wallHeightCm}
        items={model.items}
        selectedId={null}
        onSelect={NOOP_SELECT}
        onMove={NOOP_MOVE}
      />
    </div>
  );
}
