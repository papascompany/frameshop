'use client';

/**
 * Thin wrapper around `@radix-ui/react-dialog`.
 *
 * Radix handles: portal, focus trap, focus restore to the triggering element,
 * ESC-to-close, overlay click, scroll lock, and ARIA attributes (role,
 * aria-modal, aria-labelledby, aria-describedby).
 *
 * Public API (open / onOpenChange / title / description / children / footer
 * / maxWidth) is unchanged from the previous custom implementation, so all
 * existing call sites keep working.
 */

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width override. */
  maxWidth?: string;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  maxWidth = 'max-w-md',
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <RadixDialog.Content
            className={cn(
              'relative bg-surface border border-border shadow-xl',
              'rounded-card w-full p-5 focus:outline-none',
              maxWidth,
            )}
          >
            <RadixDialog.Title className="text-lg font-semibold mb-1">
              {title}
            </RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="text-sm text-muted-fg mb-4">
                {description}
              </RadixDialog.Description>
            ) : null}
            <div className="mt-2">{children}</div>
            {footer ? (
              <div className="mt-5 flex gap-2 justify-end">{footer}</div>
            ) : null}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
