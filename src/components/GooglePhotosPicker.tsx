'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';

type GoogleMediaItem = {
  id: string;
  baseUrl: string;
  filename: string;
  mediaMetadata: {
    width: string;
    height: string;
  };
};

type Props = {
  /** google_client_id가 설정된 경우에만 활성화 */
  isEnabled: boolean;
  onSelect: (photoUrl: string, width: number, height: number) => void;
};

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'connected'; items: GoogleMediaItem[] }
  | { status: 'error'; message: string }
  | { status: 'expired' };

export function GooglePhotosPicker({ isEnabled, onSelect }: Props) {
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    if (!isEnabled) return;
    // 기 연결 여부 확인
    void loadPhotos();
  }, [isEnabled]);

  async function loadPhotos() {
    setState({ status: 'loading' });
    try {
      const res = await fetch('/api/photos/google');
      if (res.status === 404) {
        // 미연결
        setState({ status: 'idle' });
        return;
      }
      const data = (await res.json()) as {
        items?: GoogleMediaItem[];
        error?: string;
        expired?: boolean;
      };
      if (!res.ok) {
        if (data.expired) {
          setState({ status: 'expired' });
          return;
        }
        setState({ status: 'error', message: data.error ?? '불러오기 실패' });
        return;
      }
      setState({ status: 'connected', items: data.items ?? [] });
    } catch {
      setState({ status: 'error', message: '네트워크 오류' });
    }
  }

  if (!isEnabled) {
    return (
      <p className="text-xs text-muted-fg">
        Google Photos 연동이 비활성화되어 있습니다. 어드민 설정에서 Google OAuth를 구성하세요.
      </p>
    );
  }

  if (state.status === 'idle') {
    return (
      <div className="flex flex-col gap-3 items-start">
        <p className="text-sm text-muted-fg">
          Google 계정의 사진을 바로 사용할 수 있습니다.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { window.location.href = '/api/auth/google'; }}
        >
          Google Photos 연결
        </Button>
      </div>
    );
  }

  if (state.status === 'loading') {
    return <p className="text-sm text-muted-fg">Google Photos 불러오는 중…</p>;
  }

  if (state.status === 'expired') {
    return (
      <div className="flex flex-col gap-2 items-start">
        <p className="text-sm text-red-600">Google 연결이 만료되었습니다.</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { window.location.href = '/api/auth/google'; }}
        >
          다시 연결
        </Button>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col gap-2 items-start">
        <p className="text-sm text-red-600">{state.message}</p>
        <Button variant="secondary" size="sm" onClick={() => void loadPhotos()}>
          다시 시도
        </Button>
      </div>
    );
  }

  // connected
  const { items } = state;

  if (items.length === 0) {
    return <p className="text-sm text-muted-fg">Google Photos에 사진이 없습니다.</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto">
      {items.map((item) => {
        const w = parseInt(item.mediaMetadata.width, 10) || 1200;
        const h = parseInt(item.mediaMetadata.height, 10) || 900;
        // Google Photos baseUrl에 =w300-h300 파라미터로 썸네일 요청
        const thumbUrl = `${item.baseUrl}=w300-h300`;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.baseUrl, w, h)}
            className="relative aspect-square bg-soft-cloud rounded overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ink group"
            title={item.filename}
          >
            <Image
              src={thumbUrl}
              alt={item.filename}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-200"
              sizes="100px"
              unoptimized  // Google Photos URL은 next/image 외부 URL
            />
          </button>
        );
      })}
    </div>
  );
}
