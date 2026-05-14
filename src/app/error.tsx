'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/layout/Container';

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: Props) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <Container size="sm" className="py-20 text-center space-y-4">
      <h1 className="text-2xl font-bold">오류가 발생했습니다</h1>
      <p className="text-sm text-muted-fg">
        일시적인 오류입니다. 잠시 후 다시 시도해주세요.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-fg font-mono">{error.digest}</p>
      ) : null}
      <Button variant="primary" onClick={reset}>
        다시 시도
      </Button>
    </Container>
  );
}
