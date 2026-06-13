'use client';

import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import type { ProductId } from '@/types/common';

export function StartEditorButton({ productId }: { productId: ProductId }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Generate the editor session id ONCE so a re-tap reuses it (no extra history
  // entries / redundant studio fetches on a slow connection).
  const sessionIdRef = useRef<string | null>(null);

  return (
    <Button
      variant="primary"
      size="lg"
      fullWidth
      loading={pending}
      disabled={pending}
      onClick={() => {
        sessionIdRef.current ??= crypto.randomUUID();
        startTransition(() => {
          router.push(`/studio/${sessionIdRef.current}?productId=${productId}`);
        });
      }}
    >
      {/* '주문하기'는 결제 단계 어휘 — 여기선 편집기 진입이므로 만들기 동사 사용 */}
      내 사진으로 만들기
    </Button>
  );
}
