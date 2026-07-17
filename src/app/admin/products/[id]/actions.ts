/**
 * Server actions for /admin/products/[id] 워크스페이스 (FS-X-03).
 *
 * 패턴(admin/frames/actions.ts 미러): 모든 액션이 requireAdmin() 을 먼저 통과한
 * 뒤 formData → zod safeParse → src/lib/db/admin.ts 위임 → revalidatePath.
 * 신규 스키마(036/037) 의존 액션은 feature-probe 로 게이트해서 미적용 시
 * 42P01/42703 대신 명시적 한국어 에러를 돌려준다(ADR-024/026).
 */

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { asBrand } from '@/types/common';
import type { ProductId, SetTemplateId } from '@/types/common';
import { productTypeSchema } from '@/types/product';
import { setTemplateInputSchema, bundleRuleInputSchema } from '@/types/set';
import {
  requireAdmin,
  setProductType,
  listSetTemplates,
  upsertSetTemplate,
  deleteSetTemplate,
  toggleSetTemplateActive,
  getBundleRule,
  upsertBundleRule,
} from '@/lib/db/admin';
import {
  isBundleRulesAvailable,
  isSetTemplatesAvailable,
} from '@/lib/db/feature-probe';

export type WorkspaceActionResult = { ok: true } | { ok: false; error: string };

const ADMIN_REQUIRED = '관리자 권한이 필요합니다.';
const SET_TEMPLATES_PENDING =
  '세트 템플릿 스키마(036)가 아직 적용되지 않았습니다. 적용 후 다시 시도하세요.';
const BUNDLE_RULES_PENDING =
  '구성 규칙 스키마(037)가 아직 적용되지 않았습니다. 적용 후 다시 시도하세요.';

// ---------- FormData helpers ----------

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

/** 빈 문자열/부재 → null, 그 외 → Number (NaN 은 zod 가 거른다). */
function numOrNull(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (typeof v !== 'string' || v.trim() === '') return null;
  return Number(v);
}

function workspacePath(productId: string): string {
  return `/admin/products/${productId}`;
}

// ---------- product_type 전환 ----------

const promoteSchema = z.object({
  productId: z.string().uuid(),
  productType: productTypeSchema,
});

/**
 * single ↔ extended 전환. 승격(→extended)은 비파괴 update.
 * 다운그레이드(→single)는 세트 템플릿/구성 규칙이 남아 있으면 차단한다 —
 * 확장형 자산이 걸린 상품을 단품으로 되돌리면 편집기/카탈로그 분기가 깨진다.
 */
export async function promoteProductTypeAction(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: ADMIN_REQUIRED };
  }

  const parsed = promoteSchema.safeParse({
    productId: str(formData, 'productId'),
    productType: str(formData, 'productType'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력 검증 실패' };
  }

  const productId = asBrand<ProductId>(parsed.data.productId);

  try {
    if (parsed.data.productType === 'single') {
      // probe false = 테이블 자체가 없음 → 세트/규칙도 존재할 수 없음(통과).
      const [setsAvail, rulesAvail] = await Promise.all([
        isSetTemplatesAvailable(),
        isBundleRulesAvailable(),
      ]);
      const [templates, rule] = await Promise.all([
        setsAvail ? listSetTemplates(productId) : Promise.resolve([]),
        rulesAvail ? getBundleRule(productId) : Promise.resolve(null),
      ]);
      if (templates.length > 0 || rule) {
        return {
          ok: false,
          error:
            '세트 템플릿 또는 구성 규칙이 등록되어 있어 단품으로 전환할 수 없습니다. 먼저 세트/규칙을 삭제하세요.',
        };
      }
    }

    await setProductType(productId, parsed.data.productType);
    revalidatePath(workspacePath(parsed.data.productId));
    revalidatePath('/admin/products');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

// ---------- 세트 템플릿 ----------

export async function upsertSetTemplateAction(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: ADMIN_REQUIRED };
  }
  if (!(await isSetTemplatesAvailable())) {
    return { ok: false, error: SET_TEMPLATES_PENDING };
  }

  // slots 는 행 편집 UI 가 조립한 JSON 배열 문자열.
  let slots: unknown;
  try {
    slots = JSON.parse(str(formData, 'slots'));
  } catch {
    return { ok: false, error: '슬롯 데이터 형식이 올바르지 않습니다.' };
  }

  const parsed = setTemplateInputSchema.safeParse({
    productId: str(formData, 'productId'),
    name: str(formData, 'name'),
    slots,
    wallWMm: numOrNull(formData, 'wallWMm'),
    wallHMm: numOrNull(formData, 'wallHMm'),
    setPrice: numOrNull(formData, 'setPrice'),
    setDiscountBps: numOrNull(formData, 'setDiscountBps'),
    isActive: str(formData, 'isActive') !== 'false',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력 검증 실패' };
  }
  // 벽모드 치수는 쌍으로만 유효 — 한쪽만 있으면 그리드모드로 저장하지 않고 안내.
  if ((parsed.data.wallWMm == null) !== (parsed.data.wallHMm == null)) {
    return { ok: false, error: '벽 치수는 가로/세로(mm)를 함께 입력하거나 모두 비워야 합니다.' };
  }

  try {
    const idRaw = str(formData, 'id');
    await upsertSetTemplate({
      ...parsed.data,
      ...(idRaw ? { id: asBrand<SetTemplateId>(idRaw) } : {}),
    });
    revalidatePath(workspacePath(parsed.data.productId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

const templateRefSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
});

export async function deleteSetTemplateAction(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: ADMIN_REQUIRED };
  }
  if (!(await isSetTemplatesAvailable())) {
    return { ok: false, error: SET_TEMPLATES_PENDING };
  }

  const parsed = templateRefSchema.safeParse({
    id: str(formData, 'id'),
    productId: str(formData, 'productId'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력 검증 실패' };
  }

  try {
    await deleteSetTemplate(asBrand<SetTemplateId>(parsed.data.id));
    revalidatePath(workspacePath(parsed.data.productId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function toggleSetTemplateActiveAction(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: ADMIN_REQUIRED };
  }
  if (!(await isSetTemplatesAvailable())) {
    return { ok: false, error: SET_TEMPLATES_PENDING };
  }

  const parsed = templateRefSchema.safeParse({
    id: str(formData, 'id'),
    productId: str(formData, 'productId'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력 검증 실패' };
  }

  try {
    await toggleSetTemplateActive(
      asBrand<SetTemplateId>(parsed.data.id),
      str(formData, 'active') === 'true',
    );
    revalidatePath(workspacePath(parsed.data.productId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

// ---------- 구성 규칙 (상품 1:1) ----------

export async function upsertBundleRuleAction(
  formData: FormData,
): Promise<WorkspaceActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: ADMIN_REQUIRED };
  }
  if (!(await isBundleRulesAvailable())) {
    return { ok: false, error: BUNDLE_RULES_PENDING };
  }

  const parsed = bundleRuleInputSchema.safeParse({
    productId: str(formData, 'productId'),
    minSlots: Number(str(formData, 'minSlots')),
    maxSlots: Number(str(formData, 'maxSlots')),
    allowedSizeCodes: formData.getAll('allowedSizeCodes').map(String),
    allowedOrientations: formData.getAll('allowedOrientations').map(String),
    allowSizeMix: str(formData, 'allowSizeMix') === 'true',
    allowOrientationMix: str(formData, 'allowOrientationMix') === 'true',
    allowPhotoReuse: str(formData, 'allowPhotoReuse') === 'true',
    pricingStrategy: str(formData, 'pricingStrategy'),
    discountBps: numOrNull(formData, 'discountBps'),
    flatPrice: numOrNull(formData, 'flatPrice'),
    isActive: str(formData, 'isActive') !== 'false',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력 검증 실패' };
  }

  try {
    await upsertBundleRule(parsed.data);
    revalidatePath(workspacePath(parsed.data.productId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
