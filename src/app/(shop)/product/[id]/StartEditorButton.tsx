'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import type { ProductId } from '@/types/common';

export function StartEditorButton({ productId }: { productId: ProductId }) {
  const router = useRouter();
  return (
    <Button
      variant="primary"
      size="lg"
      fullWidth
      onClick={() => {
        const sessionId = crypto.randomUUID();
        router.push(`/studio/${sessionId}?productId=${productId}`);
      }}
    >
      주문하기
    </Button>
  );
}
