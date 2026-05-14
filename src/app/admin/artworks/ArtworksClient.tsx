'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { StockPhoto } from '@/lib/db/stock-photos';
import { upsertArtworkAction, deleteArtworkAction } from './actions';

type Props = {
  artworks: StockPhoto[];
};

function ArtworkForm({
  initial,
  onDone,
}: {
  initial?: StockPhoto;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (initial?.id) fd.append('id', initial.id);
    if (initial?.imageUrl) fd.append('existingImageUrl', initial.imageUrl);
    if (initial?.thumbUrl) fd.append('existingThumbUrl', initial.thumbUrl);
    if (initial?.widthPx) fd.append('existingWidthPx', String(initial.widthPx));
    if (initial?.heightPx) fd.append('existingHeightPx', String(initial.heightPx));
    const result = await upsertArtworkAction(fd);
    setSaving(false);
    if (result.ok) {
      onDone();
    } else {
      setError(result.error ?? '저장 실패');
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium">제목 *</label>
        <Input name="title" required defaultValue={initial?.title} placeholder="모네 — 수련" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">작가</label>
        <Input name="artist" defaultValue={initial?.artist ?? ''} placeholder="Claude Monet" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">시대/사조</label>
        <Input name="era" defaultValue={initial?.era ?? ''} placeholder="인상주의" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">정렬 순서</label>
        <Input
          name="sortOrder"
          type="number"
          defaultValue={initial?.sortOrder ?? 0}
          placeholder="0"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">
          이미지 {initial ? '(변경 시만 업로드)' : '*'}
        </label>
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          className="block text-sm text-foreground"
        />
        {initial?.thumbUrl ? (
          <div className="relative w-24 h-20">
            <Image
              src={initial.thumbUrl}
              alt={initial.title}
              fill
              className="object-cover rounded"
              sizes="96px"
            />
          </div>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          저장
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          취소
        </Button>
      </div>
    </form>
  );
}

export function ArtworksClient({ artworks }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<StockPhoto | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function openAdd() {
    setEditTarget(null);
    setShowForm(true);
  }

  function openEdit(photo: StockPhoto) {
    setEditTarget(photo);
    setShowForm(true);
  }

  function handleDone() {
    setShowForm(false);
    setEditTarget(null);
    // 화면 새로고침으로 서버 데이터 갱신
    window.location.reload();
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return;
    setDeletingId(id);
    const result = await deleteArtworkAction(id);
    if (!result.ok) {
      alert(result.error ?? '삭제 실패');
    }
    setDeletingId(null);
    window.location.reload();
  }

  if (showForm) {
    return (
      <Card padding="md">
        <h2 className="text-lg font-semibold mb-4">
          {editTarget ? '명화 수정' : '명화 추가'}
        </h2>
        <ArtworkForm initial={editTarget ?? undefined} onDone={handleDone} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={openAdd}>
          + 명화 추가
        </Button>
      </div>

      {artworks.length === 0 ? (
        <p className="text-sm text-muted-fg text-center py-8">등록된 명화가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {artworks.map((photo) => (
            <Card key={photo.id} padding="sm" className="space-y-2">
              <div className="relative aspect-[4/3] bg-soft-cloud rounded overflow-hidden">
                <Image
                  src={photo.thumbUrl}
                  alt={photo.title}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                />
              </div>
              <p className="text-xs font-medium truncate">{photo.title}</p>
              {photo.artist ? (
                <p className="text-xs text-muted-fg truncate">{photo.artist}</p>
              ) : null}
              {photo.era ? (
                <Badge variant="default" className="text-xs">
                  {photo.era}
                </Badge>
              ) : null}
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openEdit(photo)}
                  className="flex-1"
                >
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={deletingId === photo.id}
                  disabled={deletingId === photo.id}
                  onClick={() => void handleDelete(photo.id)}
                  className="flex-1"
                >
                  삭제
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
