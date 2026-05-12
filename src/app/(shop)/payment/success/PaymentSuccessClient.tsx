'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Status = 'pending' | 'success' | 'failed';

type Props = {
  paymentKey: string;
  orderId: string;
  amount: number;
};

export function PaymentSuccessClient({ paymentKey, orderId, amount }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    async function run() {
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
          setMessage(body.message ?? body.code ?? '결제 확인 실패');
        }
      } catch (err) {
        setStatus('failed');
        setMessage(err instanceof Error ? err.message : 'unknown');
      }
    }
    void run();
  }, [paymentKey, orderId, amount, router]);

  if (status === 'pending') {
    return <p className="text-center text-sm">결제 확인 중입니다...</p>;
  }
  if (status === 'failed') {
    return (
      <div className="text-center">
        <p className="text-lg font-semibold mb-2">결제 확인 실패</p>
        <p className="text-sm text-muted-fg">{message}</p>
      </div>
    );
  }
  return null;
}
