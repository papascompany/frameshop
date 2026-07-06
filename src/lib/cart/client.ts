/**
 * Client cart API (browser-only).
 *
 * - Anon: reads/writes LocalStorage.
 * - Authed: writes through /api/cart (server upserts row) AND mirrors locally.
 *
 * Auth state is read from the Supabase browser client.
 */

import { asBrand } from '@/types/common';
import type { LocalId } from '@/types/common';
import type {
  AddToCartInput,
  CartItem,
  CartSummary,
  SyncResult,
} from '@/types/cart';
import { clampQuantity, getCartSummary } from './summary';
import { clearLocalCart, readLocalCart, writeLocalCart } from './storage';
import { getBrowserSupabase } from '../supabase/client';

async function isAuthed(): Promise<boolean> {
  try {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

export async function addToCart(input: AddToCartInput): Promise<CartItem> {
  const item: CartItem = {
    ...input,
    localId: asBrand<LocalId>(crypto.randomUUID()),
    quantity: clampQuantity(input.quantity),
    createdAt: new Date().toISOString(),
  };

  const items = readLocalCart();
  writeLocalCart([item, ...items]);

  if (await isAuthed()) {
    await fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
  }

  return item;
}

/**
 * FS-P1 Final P0-001: DB 카트(034/035 미적용 = probe false → 평면 저장)에
 * localStorage 미러의 묶음 필드를 localId 기준으로 병합한다. 이 병합이 없으면
 * 로그인 사용자의 체크아웃 페이로드에 projectId 가 실리지 않아 createOrder 의
 * variant_snapshot 동결(ADR-025 Decision 6)이 불성립한다.
 *
 * 규칙:
 * - DB 항목에 projectId 가 이미 있으면(probe true — 서버 헤더 PK) DB 가 SSOT,
 *   병합하지 않는다.
 * - DB 항목이 평면이고 미러의 동일 localId 항목에 projectId 가 있으면
 *   projectId/projectSeq/orientation 만 주입한다 — 가격·수량 등 서버 값 우선.
 * - 한계(교차 기기): 담은 기기가 아닌 기기에는 미러가 없어 병합 불가 — 그 주문은
 *   묶음 메타 없이 평면 생성된다(ADR-025 Postscript 문서화, 034/035 적용 시 해소).
 */
export function mergeProjectFieldsFromMirror(
  dbItems: CartItem[],
  mirror: CartItem[],
): CartItem[] {
  const byLocalId = new Map(mirror.map((m) => [m.localId as string, m]));
  return dbItems.map((item) => {
    if (item.projectId != null) return item;
    const local = byLocalId.get(item.localId as string);
    if (!local || local.projectId == null) return item;
    return {
      ...item,
      projectId: local.projectId,
      ...(local.projectSeq != null ? { projectSeq: local.projectSeq } : {}),
      ...(local.orientation != null ? { orientation: local.orientation } : {}),
    };
  });
}

export async function getCart(): Promise<CartItem[]> {
  if (await isAuthed()) {
    const res = await fetch('/api/cart', { cache: 'no-store' });
    if (res.ok) {
      const body = (await res.json()) as { ok: boolean; items: CartItem[] };
      if (body.ok) return mergeProjectFieldsFromMirror(body.items, readLocalCart());
    }
  }
  return readLocalCart();
}

export async function updateQuantity(
  localId: LocalId,
  quantity: number,
): Promise<void> {
  const clamped = clampQuantity(quantity);
  const items = readLocalCart().map((i) =>
    i.localId === localId ? { ...i, quantity: clamped } : i,
  );
  writeLocalCart(items);
  if (await isAuthed()) {
    await fetch(`/api/cart/${localId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: clamped }),
    });
  }
}

export async function removeFromCart(localId: LocalId): Promise<void> {
  const items = readLocalCart().filter((i) => i.localId !== localId);
  writeLocalCart(items);
  if (await isAuthed()) {
    await fetch(`/api/cart/${localId}`, { method: 'DELETE' });
  }
}

export async function clearCart(localIds?: LocalId[]): Promise<void> {
  if (!localIds) {
    clearLocalCart();
  } else {
    const items = readLocalCart().filter((i) => !localIds.includes(i.localId));
    writeLocalCart(items);
  }
  if (await isAuthed()) {
    if (localIds && localIds.length > 0) {
      await Promise.all(
        localIds.map((id) => fetch(`/api/cart/${id}`, { method: 'DELETE' })),
      );
    }
  }
}

/**
 * localStorage 카트를 로그인 계정의 DB 카트로 올린다(항목별 POST, local_id dedup).
 *
 * 확장형 묶음(ADR-025): v2 로컬 항목의 projectId(클라 로컬 그룹 키)/projectSeq/
 * orientation 은 그대로 서버에 전달되고, probe 분기(034/035 적용 여부)는 서버
 * (`upsertCartItem`)가 수행한다 — 적용 시 projectLocalId 별 cart_projects 헤더를
 * 먼저 upsert 한 뒤 자식 라인을 FK 로 링크하고(항목별 POST 라 라인마다 헤더
 * dedup → FK 순서 보장), 미적용 시 project 필드를 드롭해 평면 저장한다.
 * 드롭된 묶음 정보는 동일 기기에서는 getCart 의 로컬 미러 병합
 * (mergeProjectFieldsFromMirror)으로 체크아웃 페이로드에 복원돼 주문 생성 시
 * variant_snapshot(jsonb)에 동결된다 — 교차 기기에는 미러가 없어 평면 주문이
 * 되는 한계가 있다(FS-P1 Final P0-001, ADR-025 Postscript).
 * 클라이언트는 분기하지 않는다(probe 는 service-role 전용 서버 모듈).
 */
export async function syncCartOnLogin(): Promise<SyncResult> {
  const items = readLocalCart();
  let added = 0;
  let skipped = 0;
  for (const item of items) {
    const res = await fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (res.ok) added++;
    else skipped++;
  }
  return { added, skipped };
}

export { getCartSummary };
export type { CartSummary };
