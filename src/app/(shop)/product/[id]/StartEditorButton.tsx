'use client';

import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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

/**
 * FS-P1-03 (ADR-025): 확장형(멀티포토) 편집기 진입 보조 CTA — `?mode=multi`.
 * StartEditorButton 과 같은 세션-재사용 패턴, secondary 스타일.
 */
export function StartMultiEditorButton({ productId }: { productId: ProductId }) {
  const t = useTranslations('product');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const sessionIdRef = useRef<string | null>(null);

  return (
    <Button
      variant="secondary"
      size="lg"
      fullWidth
      loading={pending}
      disabled={pending}
      data-testid="start-multi-editor"
      onClick={() => {
        sessionIdRef.current ??= crypto.randomUUID();
        startTransition(() => {
          router.push(
            `/studio/${sessionIdRef.current}?productId=${productId}&mode=multi`,
          );
        });
      }}
    >
      {t('multiCta')}
    </Button>
  );
}
