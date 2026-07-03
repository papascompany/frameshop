import type { Metadata } from 'next';
import { getWallCatalog } from '@/lib/db/wall';
import type { WallCatalogProduct } from '@/lib/wall/catalog';
import { WallClient } from './WallClient';

/**
 * 포토월 시뮬레이터 (FS-EC-04).
 *
 * Server Component: fetches the sellable frame catalog (sizes + frame PNG
 * colours) and hands it to the client shell. Konva is loaded client-side
 * only (WallClient → dynamic ssr:false, ADR-015).
 */

export const metadata: Metadata = {
  title: '포토월 시뮬레이터 | FrameShop',
  description:
    '벽 크기를 입력하고 판매 중인 액자를 실측 비율로 배치해 보는 포토월 시뮬레이터.',
};

export default async function WallPage() {
  let catalog: WallCatalogProduct[] = [];
  try {
    catalog = await getWallCatalog();
  } catch (err) {
    console.warn('wall catalog fetch failed:', err);
  }

  return <WallClient catalog={catalog} />;
}
