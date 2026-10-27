'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { tossErrorCopy } from '@/lib/payment/error-copy';

type Status = 'pending' | 'success' | 'failed';

type Props = {
  paymentKey: string;
  orderId: string;
  amount: number;
  /** Why the server-side confirm (page.tsx) failed — the first thing shown. */
  initialMessage: string;
};

/** "확인 중" UI — shared by the streamed loading.tsx and the retry state. */
export function PaymentConfirmingNotice() {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <span
        className="inline-block w-8 h-8 rounded-full border-2 border-hairline border-t-ink animate-spin"
        aria-hidden
      />
      <p className="text-sm font-medium">결제를 확인하고 있어요.</p>
      <p className="text-xs text-muted-fg">창을 닫지 말고 잠시만 기다려 주세요.</p>
    </div>
  );
}

/**
 * Rendered only when the server-side confirm did not succeed: shows the reason
 * and lets the buyer retry via /api/payment/confirm (idempotent — a payment
 * already approved by an earlier attempt converges on PAID, never a double charge).
 */
export function PaymentSuccessClient({ paymentKey, orderId, amount, initialMessage }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('failed');
  const [message, setMessage] = useState<string>(initialMessage);
  const [retrying, setRetrying] = useState(false);

  async function confirm() {
    try {
      const res = await fetch('/api/payment/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentKey, orderId, amount }),
      });
      const body = (await res.json()) as { ok: boolean; code?: string; message?: string };
      if (body.ok) {
        setStatus('success');
        router.replace(`/order/success?orderNo=${orderId}`);
      } else {
        setStatus('failed');
        setMessage(tossErrorCopy(body.code, body.message));
      }
    } catch {
      setStatus('failed');
      setMessage('결제 확인 중 네트워크 오류가 발생했습니다.');
    }
  }

  if (status === 'pending') {
    return <PaymentConfirmingNotice />;
  }

  if (status === 'failed') {
    return (
      <div className="flex flex-col gap-4 py-6">
        <div className="text-center">
          <p className="text-lg font-semibold mb-1">결제 확인이 지연되었어요</p>
          <p className="text-sm text-muted-fg">{message}</p>
        </div>

        {/* 결제가 이미 처리됐을 수 있으므로 안심 + 복구 경로 제공 */}
        <div className="rounded-md border border-hairline bg-soft-cloud px-4 py-3 text-sm text-foreground">
          결제는 정상 처리되었을 수 있습니다. 아래에서 <b className="font-medium">주문 조회</b>로
          상태를 확인해 주세요. 중복 결제는 발생하지 않습니다.
          <p className="mt-1 text-xs text-muted-fg">주문번호: <span className="font-mono">{orderId}</span></p>
        </div>

        <div className="flex flex-col gap-2">
          <Link href={`/order/lookup?orderNo=${encodeURIComponent(orderId)}`} className="w-full">
            <Button variant="primary" size="lg" fullWidth>
              주문 조회하기
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            loading={retrying}
            onClick={async () => {
              setRetrying(true);
              setStatus('pending');
              await confirm();
              setRetrying(false);
            }}
          >
            결제 확인 다시 시도
          </Button>
          <p className="text-center text-xs text-muted-fg">
            계속 문제가 있으면 고객센터로 위 주문번호와 함께 문의해 주세요.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
