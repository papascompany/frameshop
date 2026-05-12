/**
 * Print-render trigger helper.
 *
 * Wraps the in-process invocation of `renderOrderItemPrint`. Today this is
 * a simple fire-and-forget `void` call so the payment-confirm hot path
 * doesn't block on Sharp's CPU work; Phase 2 will replace this stub with a
 * Supabase Edge Function or queue (see frame_skills §5.4).
 *
 * Failures here MUST NOT bubble up — payment confirmation must succeed even
 * if rendering is delayed or fails. Operators reconcile failed renders via
 * admin retry (TODO: ticket).
 */

import 'server-only';
import type { OrderItemId } from '@/types/common';
import { renderOrderItemPrint } from './pipeline';

/**
 * Fire-and-forget print render for a single order item. Logs but never
 * throws.
 */
export function enqueuePrintRender(orderItemId: OrderItemId): void {
  // `void` is intentional: see file header. We use a microtask scheduler so
  // the caller's await chain (e.g. `transitionTo` → response) is unblocked.
  queueMicrotask(() => {
    renderOrderItemPrint(orderItemId).catch((err: unknown) => {
      console.error(
        JSON.stringify({
          event: 'print_render_failed',
          orderItemId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  });
}
