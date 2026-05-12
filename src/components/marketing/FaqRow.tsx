'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  question: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

/**
 * FaqRow — Nike `/membership` FAQ accordion row.
 *
 *  Composition (DESIGN-nike.md `faq-row`):
 *   - bg-canvas, rounded.none
 *   - 24px vertical padding (matches `pdp-disclosure-row`)
 *   - 1px hairline divider below each row
 *   - label `heading-md` (16px medium) text-ink, chevron text-ink right
 *
 *  Self-contained accordion (no portal/Radix needed) — useful for FAQs,
 *  PDP disclosures, and order-status accordions throughout the site.
 */
export function FaqRow({ question, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const panelId = `${id}-panel`;
  const headerId = `${id}-header`;
  return (
    <div className="border-b border-hairline">
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center justify-between gap-4 py-6',
          'text-left heading-md text-ink',
          'tap-collapse transition-colors',
          'hover:text-charcoal',
          'focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-4 focus-visible:outline',
        )}
      >
        <span>{question}</span>
        <span
          aria-hidden
          className={cn(
            'shrink-0 transition-transform duration-200',
            open ? 'rotate-180' : 'rotate-0',
          )}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="pb-6 body-md text-charcoal"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
