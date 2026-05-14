'use client';

import Image from 'next/image';
import type { StockPhoto } from '@/lib/db/stock-photos';

type Props = {
  artworks: StockPhoto[];
  onSelect: (artwork: StockPhoto) => void;
};

export function ArtworkPicker({ artworks, onSelect }: Props) {
  if (artworks.length === 0) {
    return (
      <p className="text-sm text-muted-fg py-4 text-center">
        등록된 명화가 없습니다. 어드민에서 추가해주세요.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
      {artworks.map((photo) => (
        <button
          key={photo.id}
          type="button"
          onClick={() => onSelect(photo)}
          className="group flex flex-col gap-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded overflow-hidden"
        >
          <div className="relative aspect-[4/3] bg-soft-cloud rounded overflow-hidden w-full">
            <Image
              src={photo.thumbUrl}
              alt={photo.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-200"
              sizes="(max-width: 640px) 50vw, 33vw"
            />
          </div>
          <p className="text-xs font-medium truncate leading-tight px-0.5">
            {photo.title}
          </p>
          {photo.artist ? (
            <p className="text-xs text-muted-fg truncate px-0.5">{photo.artist}</p>
          ) : null}
        </button>
      ))}
    </div>
  );
}
