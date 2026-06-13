'use client';

import { useState } from 'react';

/** Order number with a tap-to-copy button (mono + copy affordance). */
export function OrderNoCopy({ orderNo }: { orderNo: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(orderNo);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the number is still visible to copy manually */
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono font-medium">{orderNo}</span>
      <button
        type="button"
        onClick={() => void copy()}
        className="text-xs underline text-mute hover:text-foreground"
        aria-label="주문번호 복사"
      >
        {copied ? '복사됨 ✓' : '복사'}
      </button>
    </span>
  );
}
