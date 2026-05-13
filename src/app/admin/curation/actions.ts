/**
 * Server actions for `/admin/curation`.
 *
 * The `curations.payload` column is `jsonb`. We validate the payload at the IO
 * boundary using the per-type schemas (banner/collection/feature). Banner
 * URLs are checked against `httpsUrl()` — see ADR-016 / P1-07.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { asBrand } from '@/types/common';
import type { CurationId } from '@/types/common';
import {
  payloadSchemaFor,
  type CurationDevice,
  type CurationType,
} from '@/types/curation';
import type { CurationInput } from '@/types/admin';
import { curationInputSchema } from '@/types/admin';
import { requireAdmin, upsertCuration, deleteCuration } from '@/lib/db/admin';

export type CurationActionResult =
  | { ok: true }
  | { ok: false; error: string };

type RawCurationFormPayload = {
  id?: string;
  type: CurationType;
  title: string | null;
  payload: unknown;
  device: CurationDevice;
  startAt: string | null;
  endAt: string | null;
  isActive: boolean;
  sortOrder: number;
};

export async function deleteCurationAction(
  id: string,
): Promise<CurationActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  try {
    await deleteCuration(asBrand<CurationId>(id));
    revalidatePath('/admin/curation');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function upsertCurationAction(
  raw: RawCurationFormPayload,
): Promise<CurationActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  // 1) Validate the envelope.
  const envelope = curationInputSchema.safeParse(raw);
  if (!envelope.success) {
    return {
      ok: false,
      error: envelope.error.issues[0]?.message ?? '입력 검증 실패',
    };
  }

  // 2) Validate the typed payload (banner URLs https-only, etc.).
  const payloadSchema = payloadSchemaFor(envelope.data.type);
  const payloadParsed = payloadSchema.safeParse(raw.payload);
  if (!payloadParsed.success) {
    return {
      ok: false,
      error: `payload: ${payloadParsed.error.issues[0]?.message ?? '검증 실패'}`,
    };
  }

  // 3) Persist. payload union must carry its discriminator.
  const input: CurationInput & { id?: CurationId } = {
    type: envelope.data.type,
    title: envelope.data.title,
    payload: { type: envelope.data.type, ...payloadParsed.data } as CurationInput['payload'],
    device: envelope.data.device,
    startAt: envelope.data.startAt,
    endAt: envelope.data.endAt,
    isActive: envelope.data.isActive,
    sortOrder: envelope.data.sortOrder,
  };
  if (raw.id) input.id = asBrand<CurationId>(raw.id);

  try {
    await upsertCuration(input);
    revalidatePath('/admin/curation');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
