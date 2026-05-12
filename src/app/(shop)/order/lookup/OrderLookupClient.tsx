'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatPhone } from '@/lib/checkout/validate';

/**
 * Phase 1 stub for guest order lookup. The actual server endpoint
 * `/api/orders/lookup` is wired in Phase 2 — for now this surfaces the
 * placeholder UI so users see the entry-point on the header nav.
 */
export function OrderLookupClient() {
  const [orderNo, setOrderNo] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  function lookup() {
    if (!/^\d{8}-\d{4}$/.test(orderNo)) {
      setMessage('주문번호 형식이 올바르지 않습니다. 예: 20260512-0001');
      return;
    }
    if (!/^01[0-9]-\d{3,4}-\d{4}$/.test(phone)) {
      setMessage('전화번호 형식이 올바르지 않습니다.');
      return;
    }
    setMessage('주문 조회 기능은 곧 제공됩니다.');
  }

  return (
    <Card padding="md" className="flex flex-col gap-3">
      <Input
        label="주문번호"
        value={orderNo}
        onChange={(e) => setOrderNo(e.target.value)}
        placeholder="20260512-0001"
      />
      <Input
        label="전화번호"
        value={phone}
        onChange={(e) => setPhone(formatPhone(e.target.value))}
        inputMode="tel"
      />
      <Button variant="primary" onClick={lookup}>조회</Button>
      {message ? <p className="text-sm text-muted-fg">{message}</p> : null}
    </Card>
  );
}
