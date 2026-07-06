'use client';

/**
 * 확장형(멀티포토) 사진 보관함 패널 — FS-P1-03 (ADR-025).
 *
 * StudioClient 가 kind:'extended' 일 때만 렌더한다(베이직 회귀 0). 멀티 파일
 * 업로드(순차 업로드 + 진행 표시)와 풀 썸네일 그리드를 담당하고, 사진 탭 →
 * 캔버스 활성/풀 제거는 콜백으로 StudioClient 에 위임한다(업로드·스토어 액션은
 * 부모가 소유 — 이 컴포넌트는 표현 전용).
 *
 * 반응형: 모바일(<md)은 가로 스크롤 스트립, md+ 는 좌측 컬럼 그리드.
 */

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { PhotoId } from '@/types/common';
import type { ProjectPhotoRef } from '@/types/project';

type Props = {
  pool: ProjectPhotoRef[];
  /** 현재 캔버스에서 편집 중인 사진 id(하이라이트 표시). */
  activePhotoId: string | null;
  uploading: boolean;
  /** 순차 업로드 진행 상태. null = 진행 중 아님. */
  progress: { done: number; total: number } | null;
  error: string | null;
  onFiles: (files: File[]) => void;
  onSelect: (ref: ProjectPhotoRef) => void;
  onRemove: (photoId: PhotoId) => void;
};

export function PhotoPoolPanel({
  pool,
  activePhotoId,
  uploading,
  progress,
  error,
  onFiles,
  onSelect,
  onRemove,
}: Props) {
  const t = useTranslations('studio');

  return (
    <section
      data-testid="photo-pool-panel"
      className="mb-4 border border-hairline rounded-md p-3"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium">
          {t('multiPool')}{' '}
          <span className="text-mute">({pool.length})</span>
        </p>
        <label className="inline-block shrink-0">
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/heic,image/webp"
            className="sr-only"
            disabled={uploading}
            data-testid="pool-file-input"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              // 같은 파일을 다시 선택해도 change 가 발화하도록 리셋.
              e.target.value = '';
              if (files.length > 0) onFiles(files);
            }}
          />
          <span
            className="inline-flex items-center justify-center h-9 px-4 rounded-[30px] bg-ink text-on-primary text-xs font-medium cursor-pointer tap-collapse"
            aria-busy={uploading}
          >
            {progress
              ? t('multiUploading', { done: progress.done, total: progress.total })
              : t('multiUpload')}
          </span>
        </label>
      </div>

      {pool.length === 0 ? (
        <p className="caption-md text-mute">{t('multiPoolEmpty')}</p>
      ) : (
        <>
          <ul className="flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-5 md:overflow-visible md:pb-0">
            {pool.map((ref) => {
              const isActive = activePhotoId !== null && ref.photoId === activePhotoId;
              return (
                <li key={ref.photoId} className="relative shrink-0">
                  <button
                    type="button"
                    data-testid="pool-photo"
                    onClick={() => onSelect(ref)}
                    className={cn(
                      'block w-16 h-16 md:w-full md:h-auto md:aspect-square rounded overflow-hidden border-2 bg-soft-cloud',
                      isActive ? 'border-ink' : 'border-hairline hover:border-ink',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ref.previewUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={t('multiPoolRemove')}
                    data-testid="pool-remove"
                    onClick={() => onRemove(ref.photoId)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-on-primary text-[10px] leading-none grid place-items-center"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 caption-md text-mute">
            {activePhotoId === null ? t('multiPoolSelectHint') : t('multiPoolRemoveNote')}
          </p>
        </>
      )}

      {error ? (
        <p role="alert" className="mt-2 caption-md text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
