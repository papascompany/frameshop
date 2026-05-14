import { requireAdmin } from '@/lib/db/admin';
import { getAllStockPhotos } from '@/lib/db/stock-photos';
import { ArtworksClient } from './ArtworksClient';

export const metadata = { title: '명화 관리 · FrameShop Admin' };

export default async function AdminArtworksPage() {
  await requireAdmin();
  const artworks = await getAllStockPhotos();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">명화 갤러리 관리</h1>
        <p className="text-sm text-muted-fg mt-1">
          사용자 편집기에 표시될 명화 이미지를 등록·관리합니다.
        </p>
      </div>
      <ArtworksClient artworks={artworks} />
    </div>
  );
}
