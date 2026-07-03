/**
 * GET /api/admin/orders/[id]/zip — 주문 인쇄파일 일괄 ZIP 다운로드 (FS-EC-03).
 *
 * 미들웨어(/api/admin/*)가 admin 세션을 강제하지만, 서버 사이드 재검증 원칙에
 * 따라 requireAdmin() 으로 한 번 더 확인한다(이중 게이트 — export route 와 동일).
 *
 * 주문 items 의 print_file_url(있는 것만)을 서버에서 fetch 해 JSZip STORE
 * (무압축 — 인쇄 JPEG 는 이미 압축돼 있어 DEFLATE 이득이 없다)로 묶는다.
 * fetch 대상은 우리 Supabase Storage origin 으로 제한한다(SSRF 심층방어,
 * FS-EC P2-2). 개별 파일 fetch 실패/차단은 스킵하고 manifest.txt 에 기록한다.
 * 파일 후보가 0건이면 404, 전부 실패하면 502.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/db/admin';
import { getOrder } from '@/lib/db/order';
import { envPublic } from '@/lib/env-public';
import type { OrderItem, OrderWithItems } from '@/types/order';

/** ZIP 엔트리 이름에 안전한 문자만 남긴다(경로 구분자/제어문자 제거). */
function sanitizeEntryName(s: string): string {
  const cleaned = s.replace(/[^0-9A-Za-z가-힣._-]+/g, '_');
  return cleaned.length > 0 ? cleaned.slice(0, 40) : 'item';
}

/** URL 경로의 확장자를 보존한다(인쇄 파일은 통상 JPEG — 기본 .jpg). */
function entryExt(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const m = /\.(jpe?g|png|webp|tiff?|pdf)$/i.exec(pathname);
    return m ? `.${m[1].toLowerCase()}` : '.jpg';
  } catch {
    return '.jpg';
  }
}

type PrintableItem = OrderItem & { printFileUrl: string };

/**
 * SSRF 심층방어(FS-EC P2-2): print_file_url 은 렌더 파이프라인이 채우는 서버
 * 생성 Storage URL 이라 사용자 조작 불가지만, 행이 손상돼도 임의 호스트로
 * 서버 fetch 가 나가지 않도록 우리 Supabase Storage origin 만 허용한다.
 */
function isSupabaseStorageOrigin(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).origin === new URL(envPublic.supabaseUrl()).origin;
  } catch {
    return false; // 파싱 불가/상대 URL/env 미설정 — fail closed
  }
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Defense-in-depth: middleware already gates /api/admin/*, but we re-verify
  // the session server-side. Never trust the gateway alone.
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;

  let order: OrderWithItems | null;
  try {
    order = await getOrder(id);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'admin_order_zip_failed',
        ctx: { id, message: err instanceof Error ? err.message : 'unknown' },
      }),
    );
    return NextResponse.json({ error: '주문 조회에 실패했습니다.' }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
  }

  const candidates = order.items.filter(
    (item): item is PrintableItem =>
      item.printFileUrl != null && item.printFileUrl.length > 0,
  );
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: '다운로드할 인쇄 파일이 없습니다.' },
      { status: 404 },
    );
  }

  const zip = new JSZip();
  const manifest: string[] = [
    `order: ${order.orderNo as string}`,
    `generated: ${new Date().toISOString()}`,
    '',
  ];
  let added = 0;

  for (const [idx, item] of candidates.entries()) {
    const name = `${String(idx + 1).padStart(2, '0')}_${sanitizeEntryName(
      item.snapshot.productName,
    )}_${sanitizeEntryName(item.snapshot.sizeLabel)}${entryExt(item.printFileUrl)}`;

    if (!isSupabaseStorageOrigin(item.printFileUrl)) {
      manifest.push(`[SKIP] ${name} — origin not allowed (${item.printFileUrl})`);
      console.warn(
        JSON.stringify({
          event: 'admin_order_zip_skip',
          ctx: {
            orderNo: order.orderNo,
            itemId: item.id,
            reason: 'origin_not_allowed',
          },
        }),
      );
      continue;
    }

    try {
      const res = await fetch(item.printFileUrl);
      if (!res.ok) {
        manifest.push(`[SKIP] ${name} — HTTP ${res.status} (${item.printFileUrl})`);
        console.warn(
          JSON.stringify({
            event: 'admin_order_zip_skip',
            ctx: {
              orderNo: order.orderNo,
              itemId: item.id,
              httpStatus: res.status,
            },
          }),
        );
        continue;
      }
      const bytes = await res.arrayBuffer();
      zip.file(name, bytes, { compression: 'STORE' });
      manifest.push(`[OK]   ${name} (${bytes.byteLength} bytes)`);
      added += 1;
    } catch (err) {
      manifest.push(
        `[SKIP] ${name} — fetch failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      console.warn(
        JSON.stringify({
          event: 'admin_order_zip_skip',
          ctx: {
            orderNo: order.orderNo,
            itemId: item.id,
            message: err instanceof Error ? err.message : 'unknown',
          },
        }),
      );
    }
  }

  if (added === 0) {
    console.error(
      JSON.stringify({
        event: 'admin_order_zip_all_failed',
        ctx: { orderNo: order.orderNo, candidates: candidates.length },
      }),
    );
    return NextResponse.json(
      { error: '인쇄 파일 다운로드에 모두 실패했습니다.' },
      { status: 502 },
    );
  }

  zip.file('manifest.txt', manifest.join('\n'));
  // ArrayBuffer 는 그대로 BodyInit — Blob 래핑은 런타임별 stream() 지원 차이가 있다.
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' });

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      // orderNo(YYYYMMDD-NNNN)는 ASCII — filename 헤더에 안전하다.
      'Content-Disposition': `attachment; filename="${order.orderNo as string}_print.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
