/**
 * Server actions for `/admin/frames`.
 *
 * Pattern: separate `actions.ts` file with module-level `'use server'` so the
 * client form components can import them as plain async functions. Each action
 * calls `requireAdmin()` first (defense in depth alongside RLS) and then
 * delegates to `src/lib/db/admin.ts`.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { asBrand } from '@/types/common';
import type { FrameAssetId, ProductId } from '@/types/common';
import { frameAssetInputSchema } from '@/types/admin';
import type { FrameAssetInput } from '@/types/admin';
import { requireAdmin, upsertFrameAsset } from '@/lib/db/admin';

export type FrameActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Client-callable input. `productId` is a plain string here — we re-brand it
 * inside the action after validation. Branded IDs are TS-only and would not
 * survive a network boundary anyway.
 */
export type FrameFormPayload = {
  id?: string;
  productId: string;
  colorCode: string;
  colorLabel: string;
  pngUrl: string;
  previewUrl: string | null;
  innerRect: { x: number; y: number; w: number; h: number };
};

export async function createOrUpdateFrameAction(
  raw: FrameFormPayload,
): Promise<FrameActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  // Validate at the IO boundary (admin schema is strict + https-only).
  const parsed = frameAssetInputSchema.safeParse({
    productId: raw.productId,
    colorCode: raw.colorCode,
    colorLabel: raw.colorLabel,
    pngUrl: raw.pngUrl,
    innerRect: raw.innerRect,
    previewUrl: raw.previewUrl,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? '입력 검증 실패',
    };
  }

  // Extra cross-field check: inner_rect must fit inside the [0,1]² canvas.
  const { x, y, w, h } = parsed.data.innerRect;
  if (x + w > 1 + 1e-6 || y + h > 1 + 1e-6) {
    return {
      ok: false,
      error: 'inner_rect 가 캔버스 영역을 벗어났습니다 (x+w ≤ 1, y+h ≤ 1).',
    };
  }

  try {
    const input: FrameAssetInput & { id?: FrameAssetId } = {
      productId: asBrand<ProductId>(parsed.data.productId),
      colorCode: parsed.data.colorCode,
      colorLabel: parsed.data.colorLabel,
      pngUrl: parsed.data.pngUrl,
      innerRect: parsed.data.innerRect,
      previewUrl: parsed.data.previewUrl,
    };
    if (raw.id) input.id = asBrand<FrameAssetId>(raw.id);
    await upsertFrameAsset(input);
    revalidatePath('/admin/frames');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
