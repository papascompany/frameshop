'use client';

/**
 * Photo-wall simulator client shell (FS-EC-04).
 *
 * - Wall dimensions (cm) → true-scale Konva canvas (dynamic ssr:false, ADR-015)
 * - Palette: real sellable frames (product → size → orientation → color)
 * - Placed items: drag on canvas, per-item studio deep-link ("이 액자 편집하기")
 * - Totals bar (개수·합계) — desktop inline + mobile sticky bar
 * - Layout persists to localStorage (frameshop.wall.v1, safe-parse)
 */

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { OptionTabs } from '@/components/OptionTabs';
import { Button } from '@/components/ui/Button';
import { PriceTag } from '@/components/PriceTag';
import { MobileStickyBar } from '@/components/MobileStickyBar';
import { useWallStore, useWallTotals } from '@/store/wall';
import {
  clearWallLayout,
  loadWallLayout,
  saveWallLayout,
  type PlacedWallItem,
} from '@/lib/wall/storage';
import {
  WALL_MAX_CM,
  WALL_MIN_CM,
  orientedSizeMm,
  type WallOrientation,
} from '@/lib/wall/scale';
import { buildStudioEditUrl } from '@/lib/wall/deeplink';
import type { WallCatalogProduct } from '@/lib/wall/catalog';

const WallCanvas = dynamic(() => import('@/modules/wall/WallCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full aspect-[3/2] bg-soft-cloud grid place-items-center text-sm text-mute">
      시뮬레이터를 불러오는 중…
    </div>
  ),
});

type Props = {
  catalog: WallCatalogProduct[];
};

export function WallClient({ catalog }: Props) {
  const router = useRouter();

  // ---- Wall store ----
  const wallWidthCm = useWallStore((s) => s.wallWidthCm);
  const wallHeightCm = useWallStore((s) => s.wallHeightCm);
  const items = useWallStore((s) => s.items);
  const selectedId = useWallStore((s) => s.selectedId);
  const setWallSize = useWallStore((s) => s.setWallSize);
  const addItem = useWallStore((s) => s.addItem);
  const moveItem = useWallStore((s) => s.moveItem);
  const removeItem = useWallStore((s) => s.removeItem);
  const select = useWallStore((s) => s.select);
  const clear = useWallStore((s) => s.clear);
  const hydrate = useWallStore((s) => s.hydrate);
  const { count, totalPrice } = useWallTotals();

  // ---- Palette selection (local UI state) ----
  const [productIdx, setProductIdx] = useState(0);
  const product = catalog[productIdx] ?? null;
  const [sizeCode, setSizeCode] = useState(catalog[0]?.sizes[0]?.sizeCode ?? '');
  const [colorCode, setColorCode] = useState(catalog[0]?.colors[0]?.code ?? '');
  const [orientation, setOrientation] = useState<WallOrientation>('portrait');

  const size =
    product?.sizes.find((s) => s.sizeCode === sizeCode) ?? product?.sizes[0] ?? null;
  const color =
    product?.colors.find((c) => c.code === colorCode) ?? product?.colors[0] ?? null;

  // ---- Persistence: restore once on mount, then save (debounced) ----
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const saved = loadWallLayout();
    if (saved) {
      // External store update in an effect (zustand) — same pattern as the
      // editor's draft restore.
      hydrate({
        widthCm: saved.wall.widthCm,
        heightCm: saved.wall.heightCm,
        items: saved.items,
      });
    }
  }, [hydrate]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const t = setTimeout(() => {
      saveWallLayout({
        wall: { widthCm: wallWidthCm, heightCm: wallHeightCm },
        items,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [items, wallWidthCm, wallHeightCm]);

  // ---- Handlers ----
  function handleProductChange(idxStr: string): void {
    const idx = Number(idxStr);
    const next = catalog[idx];
    if (!next) return;
    setProductIdx(idx);
    setSizeCode(next.sizes[0]?.sizeCode ?? '');
    setColorCode(next.colors[0]?.code ?? '');
  }

  function handleAdd(): void {
    if (!product || !size || !color) return;
    const { wMm, hMm } = orientedSizeMm(size.widthMm, size.heightMm, orientation);
    addItem({
      productId: product.productId as string,
      variantId: size.variantId as string,
      sizeCode: size.sizeCode,
      sizeLabel: size.sizeLabel,
      wMm,
      hMm,
      orientation,
      colorCode: color.code,
      colorLabel: color.label,
      frameUrl: color.pngUrl,
      price: size.price,
    });
  }

  function handleEdit(item: PlacedWallItem): void {
    // Fresh studio session per edit — options preselected via deep link.
    router.push(
      buildStudioEditUrl({
        sessionId: crypto.randomUUID(),
        productId: item.productId,
        sizeCode: item.sizeCode,
        colorCode: item.colorCode,
        orientation: item.orientation,
      }),
    );
  }

  function handleClear(): void {
    if (items.length > 0 && !window.confirm(`배치한 액자 ${items.length}개를 모두 지울까요?`)) {
      return;
    }
    clear();
    clearWallLayout();
  }

  if (catalog.length === 0) {
    return (
      <Container size="md" className="py-10">
        <h1 className="text-xl font-bold mb-2">포토월 시뮬레이터</h1>
        <p className="text-sm text-mute">배치할 수 있는 액자 상품이 없습니다.</p>
      </Container>
    );
  }

  return (
    <Container size="xl" className="pt-6 pb-28 md:py-10">
      <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-8">
        {/* ── 좌측: 캔버스 + 배치 목록 ─────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold mb-1">포토월 시뮬레이터</h1>
          <p className="text-sm text-mute mb-4">
            벽 크기를 입력하고 실제 판매 중인 액자를 실측 비율로 배치해 보세요.
          </p>

          {/* 벽 치수 입력 */}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <WallSizeField
              label="벽 가로 (cm)"
              value={wallWidthCm}
              onCommit={(n) => setWallSize(n, wallHeightCm)}
            />
            <WallSizeField
              label="벽 세로 (cm)"
              value={wallHeightCm}
              onCommit={(n) => setWallSize(wallWidthCm, n)}
            />
            <button
              type="button"
              className="ml-auto text-xs underline text-mute hover:text-foreground pb-2"
              onClick={handleClear}
              data-testid="wall-clear"
            >
              벽 비우기
            </button>
          </div>

          <WallCanvas
            wallWidthCm={wallWidthCm}
            wallHeightCm={wallHeightCm}
            items={items}
            selectedId={selectedId}
            onSelect={select}
            onMove={moveItem}
          />
          <p className="mt-2 caption-md text-mute">
            액자를 드래그해 위치를 조정하세요. 주황 점선은 권장 눈높이(145cm)입니다.
          </p>

          {/* 배치 목록 */}
          {items.length > 0 ? (
            <div className="mt-6">
              <p className="text-sm font-medium mb-2">
                배치한 액자 <span className="text-mute">({items.length}개)</span>
              </p>
              <ul className="flex flex-col gap-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    data-testid="wall-item-row"
                    className={`flex items-center gap-3 border rounded-md p-2 cursor-pointer ${
                      item.id === selectedId ? 'border-ink' : 'border-hairline'
                    }`}
                    onClick={() => select(item.id)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {catalog.find((p) => (p.productId as string) === item.productId)?.name ??
                          '액자'}
                      </p>
                      <p className="text-xs text-mute">
                        {item.sizeLabel} · {item.colorLabel} ·{' '}
                        {item.orientation === 'portrait' ? '세로형' : '가로형'}
                      </p>
                    </div>
                    <span className="ml-auto text-sm tabular-nums text-mute shrink-0">
                      {item.price.toLocaleString('ko-KR')}원~
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="wall-item-edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(item);
                      }}
                    >
                      이 액자 편집하기
                    </Button>
                    <button
                      type="button"
                      aria-label="삭제"
                      className="text-mute hover:text-foreground px-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(item.id);
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* ── 우측: 팔레트 + 합계 ──────────────────────────────────── */}
        <div className="mt-6 lg:mt-0 flex flex-col gap-5">
          {catalog.length > 1 ? (
            <OptionTabs
              label="상품"
              value={String(productIdx)}
              onChange={handleProductChange}
              options={catalog.map((p, i) => ({ value: String(i), label: p.name }))}
            />
          ) : null}
          {product ? (
            <>
              <OptionTabs
                label="사이즈"
                value={size?.sizeCode ?? ''}
                onChange={setSizeCode}
                options={product.sizes.map((s) => ({
                  value: s.sizeCode,
                  label: s.sizeLabel,
                }))}
              />
              <OptionTabs
                label="방향"
                value={orientation}
                onChange={(v) => setOrientation(v as WallOrientation)}
                options={[
                  { value: 'portrait', label: '세로형' },
                  { value: 'landscape', label: '가로형' },
                ]}
              />
              <OptionTabs
                label="액자 색상"
                value={color?.code ?? ''}
                onChange={setColorCode}
                options={product.colors.map((c) => ({ value: c.code, label: c.label }))}
              />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-mute mb-0.5">선택 사이즈 가격</p>
                  <PriceTag amount={size?.price ?? 0} showFrom />
                </div>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleAdd}
                  disabled={!size || !color}
                  data-testid="wall-add-button"
                >
                  벽에 추가
                </Button>
              </div>
            </>
          ) : null}

          {/* 합계 (데스크톱) */}
          <div className="hidden lg:block border-t border-hairline pt-4">
            <div className="flex items-end justify-between gap-3">
              <p className="text-sm text-mute">액자 {count}개</p>
              <span data-testid="wall-total">
                <PriceTag amount={totalPrice} variant="large" />
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-fg">
              ※ 합계는 사이즈별 대표가(최저가) 기준입니다. 매트·인화지 옵션에 따라
              실제 가격이 달라질 수 있어요.
            </p>
          </div>

          <p className="text-xs text-muted-fg">
            ※ 각 액자의 &ldquo;이 액자 편집하기&rdquo;를 누르면 사이즈·색상·방향이
            미리 선택된 편집 스튜디오로 이동합니다.
          </p>
        </div>
      </div>

      {/* 모바일: 하단 고정 합계 바 */}
      <MobileStickyBar>
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-mute leading-none mb-0.5">액자 {count}개</p>
            <PriceTag amount={totalPrice} variant="large" />
          </div>
          <Button
            variant="primary"
            size="lg"
            className="ml-auto"
            onClick={handleAdd}
            disabled={!size || !color}
          >
            벽에 추가
          </Button>
        </div>
      </MobileStickyBar>
    </Container>
  );
}

// ── 벽 치수 입력 필드 ─────────────────────────────────────────────────────────
//
// Draft-string pattern (no setState-in-effect): the field shows the local
// draft while editing and falls back to the committed store value otherwise.
// Commit on blur/Enter with clamping delegated to the store (100~1000cm).

function WallSizeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  function commit(): void {
    onCommit(Number(shown));
    setDraft(null);
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-mute">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={WALL_MIN_CM}
        max={WALL_MAX_CM}
        step={10}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-28 h-10 px-3 rounded-md border border-hairline bg-canvas text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-ink"
      />
    </label>
  );
}
