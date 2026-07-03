/**
 * Wall zustand store (FS-EC-04): placement, clamping, totals.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useWallStore } from '@/store/wall';
import {
  WALL_DEFAULT_HEIGHT_CM,
  WALL_DEFAULT_WIDTH_CM,
} from '@/lib/wall/scale';
import type { PlacedWallItem } from '@/lib/wall/storage';

type AddInput = Omit<PlacedWallItem, 'id' | 'xMm' | 'yMm'>;

function addInput(partial: Partial<AddInput> = {}): AddInput {
  return {
    productId: 'prod-1',
    variantId: 'var-1',
    sizeCode: '4x6',
    sizeLabel: '4×6',
    wMm: 102,
    hMm: 152,
    orientation: 'portrait',
    colorCode: 'black',
    colorLabel: '블랙',
    frameUrl: 'https://cdn.example.com/frames/black.png',
    price: 19000,
    ...partial,
  };
}

beforeEach(() => {
  useWallStore.getState().reset();
});

describe('setWallSize', () => {
  it('cm 범위를 클램프하고 기존 아이템을 새 벽 안으로 되끌어온다', () => {
    const st = useWallStore.getState();
    st.addItem(addInput());
    // 아이템을 오른쪽 아래 구석으로
    const id = useWallStore.getState().items[0].id;
    useWallStore.getState().moveItem(id, 9999, 9999);
    expect(useWallStore.getState().items[0].xMm).toBe(3000 - 102);

    // 벽을 최소로 축소 → 아이템 재클램프
    useWallStore.getState().setWallSize(50, 5000);
    const s2 = useWallStore.getState();
    expect(s2.wallWidthCm).toBe(100);
    expect(s2.wallHeightCm).toBe(1000);
    expect(s2.items[0].xMm).toBe(1000 - 102); // 100cm 벽 안으로
  });
});

describe('addItem', () => {
  it('첫 아이템은 벽 중앙에 배치되고 선택된다', () => {
    useWallStore.getState().addItem(addInput());
    const s = useWallStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].xMm).toBe((3000 - 102) / 2);
    expect(s.items[0].yMm).toBe((2300 - 152) / 2);
    expect(s.selectedId).toBe(s.items[0].id);
  });

  it('연속 추가는 캐스케이드(겹침 허용, z순서 = 추가순)', () => {
    useWallStore.getState().addItem(addInput());
    useWallStore.getState().addItem(addInput());
    const [a, b] = useWallStore.getState().items;
    expect(b.xMm).toBeGreaterThan(a.xMm);
    expect(b.yMm).toBeGreaterThan(a.yMm);
    expect(a.id).not.toBe(b.id);
  });
});

describe('moveItem', () => {
  it('벽 밖 드래그는 경계로 클램프된다', () => {
    useWallStore.getState().addItem(addInput());
    const id = useWallStore.getState().items[0].id;
    useWallStore.getState().moveItem(id, -100, 99999);
    const item = useWallStore.getState().items[0];
    expect(item.xMm).toBe(0);
    expect(item.yMm).toBe(2300 - 152);
  });
});

describe('removeItem / clear / hydrate', () => {
  it('removeItem은 선택 상태도 해제한다', () => {
    useWallStore.getState().addItem(addInput());
    const id = useWallStore.getState().items[0].id;
    useWallStore.getState().removeItem(id);
    const s = useWallStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.selectedId).toBeNull();
  });

  it('hydrate는 저장 레이아웃을 복원하며 아이템을 재클램프한다', () => {
    useWallStore.getState().hydrate({
      widthCm: 200,
      heightCm: 200,
      items: [
        {
          ...addInput(),
          id: 'saved-1',
          xMm: 5000, // 저장 후 벽이 줄었다고 가정 — 복원 시 클램프
          yMm: 100,
        },
      ],
    });
    const s = useWallStore.getState();
    expect(s.wallWidthCm).toBe(200);
    expect(s.items[0].xMm).toBe(2000 - 102);
    expect(s.items[0].yMm).toBe(100);
  });

  it('clear는 아이템만 비우고 벽 치수는 유지한다', () => {
    useWallStore.getState().setWallSize(400, 250);
    useWallStore.getState().addItem(addInput());
    useWallStore.getState().clear();
    const s = useWallStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.wallWidthCm).toBe(400);
  });

  it('reset은 기본 프리셋(300×230)으로 돌아간다', () => {
    useWallStore.getState().setWallSize(400, 250);
    useWallStore.getState().reset();
    const s = useWallStore.getState();
    expect(s.wallWidthCm).toBe(WALL_DEFAULT_WIDTH_CM);
    expect(s.wallHeightCm).toBe(WALL_DEFAULT_HEIGHT_CM);
  });
});

describe('합계 (팔레트 가격 → 합계 바)', () => {
  it('items의 price 합이 합계가 된다', () => {
    useWallStore.getState().addItem(addInput({ price: 19000 }));
    useWallStore.getState().addItem(addInput({ price: 32000 }));
    const total = useWallStore
      .getState()
      .items.reduce((sum, i) => sum + i.price, 0);
    expect(total).toBe(51000);
  });
});
