/**
 * Server-side cart helpers (M-Cart).
 *
 * Authenticated users only — anon cart lives in LocalStorage and is handled
 * entirely on the client (묶음 project 필드 포함 — 034/035 와 무관하게 동작).
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type {
  CartItemId,
  CartProjectId,
  LocalId,
  PhotoId,
  ProductId,
  ProductVariantId,
  ProjectLocalId,
  UserId,
} from '@/types/common';
import type { CartItem } from '@/types/cart';
import type { Orientation } from '@/types/project';
import { isProjectCartAvailable } from './feature-probe';
import { getServerSupabase } from '../supabase/server';
import { getServiceRoleSupabase } from '../supabase/service';

type CartRowWithVariant = {
  id: string;
  local_id: string;
  user_id: string;
  variant_id: string;
  photo_id: string;
  options: CartItem['options'];
  photo_url: string;
  crop_transform: CartItem['cropTransform'];
  preview_url: string;
  price: number;
  quantity: number;
  created_at: string;
  product_variants: { product_id: string } | { product_id: string }[] | null;
  // Migration 035 columns — present only in the extended SELECT (probe true).
  project_id?: string | null;
  project_seq?: number | null;
  orientation?: Orientation | null;
};

function pickProductId(joined: CartRowWithVariant['product_variants']): string {
  if (!joined) return '';
  if (Array.isArray(joined)) return joined[0]?.product_id ?? '';
  return joined.product_id;
}

/** Legacy explicit column list — the literal pre-035 query string. */
const CART_COLUMNS =
  'id, local_id, user_id, variant_id, photo_id, options, photo_url, crop_transform, preview_url, price, quantity, created_at, product_variants(product_id)';
/**
 * Extended column list for a migrated DB (035). Kept as a SECOND string —
 * selecting the new columns on an unmigrated DB would 42703 the whole query,
 * so the probe switches between two literal paths (ADR-025 graceful contract).
 */
const CART_COLUMNS_WITH_PROJECT = `${CART_COLUMNS}, project_id, project_seq, orientation`;

export async function listCartForUser(userId: UserId): Promise<CartItem[]> {
  const supabase = await getServerSupabase();
  const withProject = await isProjectCartAvailable();
  const { data, error } = await supabase
    .from('cart_items')
    .select(withProject ? CART_COLUMNS_WITH_PROJECT : CART_COLUMNS)
    .eq('user_id', userId as string)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listCartForUser: ${error.message}`);

  return ((data ?? []) as unknown as CartRowWithVariant[]).map((row) => ({
    id: asBrand<CartItemId>(row.id),
    localId: asBrand<LocalId>(row.local_id),
    userId: asBrand<UserId>(row.user_id),
    productId: asBrand<ProductId>(pickProductId(row.product_variants)),
    variantId: asBrand<ProductVariantId>(row.variant_id),
    photoId: asBrand<PhotoId>(row.photo_id),
    options: row.options,
    photoUrl: row.photo_url,
    cropTransform: row.crop_transform,
    previewUrl: row.preview_url,
    price: row.price,
    quantity: row.quantity,
    createdAt: row.created_at,
    // ADR-025 묶음 필드 — 값이 있을 때만 포함해 레거시 행/미적용 DB 는 기존
    // item shape 을 문자 그대로 유지한다. projectId 는 서버 헤더 PK 를 그대로
    // 노출한다(카트 표시·주문 그룹핑 모두 "일관된 그룹 키"만 요구 — 정찰 확인).
    ...(row.project_id != null
      ? { projectId: asBrand<CartProjectId>(row.project_id) }
      : {}),
    ...(row.project_seq != null ? { projectSeq: row.project_seq } : {}),
    ...(row.orientation != null ? { orientation: row.orientation } : {}),
  }));
}

/**
 * cart_projects 묶음 헤더 upsert — (user_id, project_local_id) dedup 후 서버
 * PK 를 돌려준다(같은 프로젝트의 라인 N개가 각각 호출해도 헤더는 1개).
 *
 * 마이그레이션 034 의 dedup 유니크는 PARTIAL unique index(user_id IS NOT NULL
 * 조건)라 PostgREST `onConflict` 로는 arbiter 추론이 안 된다 — select-first 로
 * dedup 하고, 동시 삽입 race 는 unique violation(23505) 을 받아 re-select 로
 * 수습한다. 쓰기는 service-role 경유(034 RLS 는 회원 SELECT 만 허용).
 *
 * ADR-025 계약: 호출 전 `isProjectCartAvailable()` 가 true 여야 한다(034/035
 * 미적용 DB 에선 테이블이 없어 실패). upsertCartItem 이 그 게이트를 소유한다.
 */
export async function upsertCartProject(
  userId: UserId,
  projectLocalId: ProjectLocalId,
  productId: ProductId,
): Promise<CartProjectId> {
  const supabase = getServiceRoleSupabase();

  const { data: existing, error: selErr } = await supabase
    .from('cart_projects')
    .select('id')
    .eq('user_id', userId as string)
    .eq('project_local_id', projectLocalId as string)
    .maybeSingle();
  if (selErr) throw new Error(`upsertCartProject select: ${selErr.message}`);
  if (existing) {
    return asBrand<CartProjectId>((existing as { id: string }).id);
  }

  // P2-002 가드(FS-P1 security): GET /api/cart 는 projectId 로 서버 헤더 PK 를
  // 노출한다 — 클라이언트가 그 값을 되돌려 보내면(에코) project_local_id = 기존
  // 헤더 PK 인 중복 헤더가 조용히 생긴다. PK 일치 시 그 헤더를 재사용해 봉인.
  const { data: byPk, error: pkErr } = await supabase
    .from('cart_projects')
    .select('id')
    .eq('user_id', userId as string)
    .eq('id', projectLocalId as string)
    .maybeSingle();
  if (pkErr) throw new Error(`upsertCartProject pk-guard: ${pkErr.message}`);
  if (byPk) {
    return asBrand<CartProjectId>((byPk as { id: string }).id);
  }

  const { data: inserted, error: insErr } = await supabase
    .from('cart_projects')
    .insert({
      project_local_id: projectLocalId as string,
      user_id: userId as string,
      product_id: productId as string,
    })
    .select('id')
    .single();
  if (!insErr && inserted) {
    return asBrand<CartProjectId>((inserted as { id: string }).id);
  }

  if (insErr?.code === '23505') {
    // Lost the insert race — another request created the header between our
    // select and insert. The winner's row is the dedup target: re-select it.
    const { data: raced, error: reErr } = await supabase
      .from('cart_projects')
      .select('id')
      .eq('user_id', userId as string)
      .eq('project_local_id', projectLocalId as string)
      .maybeSingle();
    if (reErr || !raced) {
      throw new Error(
        `upsertCartProject reselect: ${reErr?.message ?? 'row missing after 23505'}`,
      );
    }
    return asBrand<CartProjectId>((raced as { id: string }).id);
  }

  throw new Error(`upsertCartProject insert: ${insErr?.message ?? 'no row returned'}`);
}

export async function upsertCartItem(input: CartItem): Promise<void> {
  // ADR-025 확장형 묶음(probe 폴백 — CTO 확정): `input.projectId` 는 클라 로컬
  // 그룹 키(projectLocalId)다. 034/035 적용 DB 에서만 cart_projects 헤더로
  // 매핑해 FK 컬럼을 채운다 — 헤더 upsert 가 반드시 자식 upsert 보다 먼저다
  // (FK 순서). 미적용 DB(probe false)에선 project 필드를 전부 생략해 현행과
  // 동일한 평면 payload 로 저장한다 — 드롭된 묶음 정보는 동일 기기에선 getCart
  // 의 로컬 미러 병합으로 주문 스냅샷에 동결되지만, 교차 기기에는 미러가 없어
  // 평면 주문이 된다(FS-P1 Final P0-001 수정 — ADR-025 Postscript 한계 문서화).
  let projectColumns: Record<string, unknown> = {};
  if (
    input.projectId != null &&
    input.userId != null &&
    (await isProjectCartAvailable())
  ) {
    const headerId = await upsertCartProject(
      input.userId,
      asBrand<ProjectLocalId>(input.projectId as string),
      input.productId,
    );
    projectColumns = {
      project_id: headerId as string,
      project_seq: input.projectSeq ?? null,
      orientation: input.orientation ?? null,
    };
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('cart_items')
    .upsert(
      {
        local_id: input.localId as string,
        user_id: input.userId as string,
        variant_id: input.variantId as string,
        photo_id: input.photoId as string,
        options: input.options,
        photo_url: input.photoUrl,
        crop_transform: input.cropTransform,
        preview_url: input.previewUrl,
        price: input.price,
        quantity: input.quantity,
        ...projectColumns,
      },
      { onConflict: 'user_id,local_id' },
    );
  if (error) throw new Error(`upsertCartItem: ${error.message}`);
}

export async function updateCartQuantity(
  userId: UserId,
  localId: LocalId,
  quantity: number,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('cart_items')
    .update({ quantity })
    .eq('user_id', userId as string)
    .eq('local_id', localId as string);
  if (error) throw new Error(`updateCartQuantity: ${error.message}`);
}

export async function removeCartItem(
  userId: UserId,
  localId: LocalId,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('user_id', userId as string)
    .eq('local_id', localId as string);
  if (error) throw new Error(`removeCartItem: ${error.message}`);
}

export async function clearCartItems(
  userId: UserId,
  localIds?: LocalId[],
): Promise<void> {
  const supabase = await getServerSupabase();
  let q = supabase.from('cart_items').delete().eq('user_id', userId as string);
  if (localIds && localIds.length > 0) {
    q = q.in('local_id', localIds as unknown as string[]);
  }
  const { error } = await q;
  if (error) throw new Error(`clearCartItems: ${error.message}`);
}
