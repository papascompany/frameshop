/**
 * /admin/products/[id] — 상품 워크스페이스 (FS-X-03, ADR-026).
 *
 * 탭: 유형(product_type) · 속성 · 프레임(FramesClient 임베드) · 옵션(OptionsClient
 * 임베드) · 구성규칙 · 세트템플릿(확장형 전용, probe 게이트).
 *
 * Server Component: 상품/카테고리/프레임/변형 + (probe 통과 시) 세트/규칙을
 * 병렬 로드해 WorkspaceClient 에 넘긴다. requireAdmin 선행(방어는 DB 계층에도).
 */

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin, getProductWorkspaceData } from '@/lib/db/admin';
import { asBrand } from '@/types/common';
import type { ProductId } from '@/types/common';
import { WorkspaceClient } from './WorkspaceClient';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminProductWorkspacePage({ params }: Props) {
  const { id } = await params;

  try {
    await requireAdmin();
  } catch {
    redirect(`/login?redirect=${encodeURIComponent(`/admin/products/${id}`)}`);
  }

  // uuid 가 아니면 DB 22P02(500) 대신 404.
  if (!UUID_RE.test(id)) notFound();

  // 상품/카테고리/프레임/변형 + (probe 통과 시) 세트/규칙 로드는 server-only
  // DB 계층으로 이동했다(getProductWorkspaceData) — page 는 조립만 담당한다.
  const data = await getProductWorkspaceData(asBrand<ProductId>(id));
  if (!data) notFound();

  const {
    product,
    categories,
    frames,
    variants,
    setTemplates,
    bundleRule,
    setTemplatesAvailable: setsAvailable,
    bundleRulesAvailable: rulesAvailable,
  } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/products"
          className="text-sm text-muted-fg hover:text-foreground transition-colors"
        >
          &larr; 상품 목록
        </Link>
        <h1 className="text-2xl font-bold">상품 워크스페이스</h1>
      </div>

      <WorkspaceClient
        product={product}
        categories={categories}
        frames={frames}
        variants={variants}
        setTemplates={setTemplates}
        bundleRule={bundleRule}
        setTemplatesAvailable={setsAvailable}
        bundleRulesAvailable={rulesAvailable}
      />
    </div>
  );
}
