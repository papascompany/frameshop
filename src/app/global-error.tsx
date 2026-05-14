'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

// global-error.tsx는 루트 layout을 대체하므로 html/body 태그 필요
export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          fontFamily: 'sans-serif',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: '16px',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>
          심각한 오류가 발생했습니다
        </h1>
        <p style={{ fontSize: '14px', color: '#666' }}>
          서비스를 일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해주세요.
        </p>
        {error.digest ? (
          <code style={{ fontSize: '12px', color: '#999' }}>{error.digest}</code>
        ) : null}
        <button
          onClick={reset}
          style={{
            padding: '10px 24px',
            backgroundColor: '#1a1a1a',
            color: 'white',
            border: 'none',
            borderRadius: '30px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          다시 시도
        </button>
      </body>
    </html>
  );
}
