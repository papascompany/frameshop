'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';

// ── Kakao Postcode API type declarations ──────────────────────────────────────

interface PostcodeData {
  /** 5자리 우편번호 */
  zonecode: string;
  /** 도로명 주소 */
  roadAddress: string;
  /** 지번 주소 */
  jibunAddress: string;
  /** 건물명 */
  buildingName: string;
  /** 공동주택 여부 */
  apartment: 'Y' | 'N';
}

declare global {
  interface Window {
    daum: {
      Postcode: new (opts: {
        oncomplete: (data: PostcodeData) => void;
      }) => { open: () => void };
    };
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

type PostcodeButtonProps = {
  /** 주소 검색 완료 시 호출 — (우편번호 5자리, 도로명주소) */
  onComplete: (zip: string, addr1: string) => void;
  disabled?: boolean;
  className?: string;
};

// ── Component ─────────────────────────────────────────────────────────────────

const KAKAO_POSTCODE_SRC =
  'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

export function PostcodeButton({
  onComplete,
  disabled,
  className,
}: PostcodeButtonProps) {
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    // Script 이미 로드됐으면 skip.
    if (document.querySelector(`script[src="${KAKAO_POSTCODE_SRC}"]`)) return;

    const script = document.createElement('script');
    script.src = KAKAO_POSTCODE_SRC;
    script.async = true;
    document.head.appendChild(script);
    scriptRef.current = script;

    return () => {
      // Unmount 시에는 script를 제거하지 않음 — 다른 컴포넌트에서 재사용 가능.
    };
  }, []);

  function handleClick() {
    if (typeof window === 'undefined' || !window.daum?.Postcode) {
      // Script 아직 로딩 중 — 사용자에게 재시도 유도.
      alert('주소 검색 모듈을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }

    new window.daum.Postcode({
      oncomplete(data) {
        const zip = data.zonecode;
        // 도로명 주소 우선, 없으면 지번 주소.
        const addr1 = data.roadAddress || data.jibunAddress;
        onComplete(zip, addr1);
      },
    }).open();
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled}
      onClick={handleClick}
      className={className}
    >
      주소 검색
    </Button>
  );
}
