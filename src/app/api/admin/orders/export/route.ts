/**
 * GET /api/admin/orders/export — 관리자 주문 목록 CSV 내보내기.
 *
 * 미들웨어(/api/admin/*)가 admin 세션을 강제하므로 1차 게이트는 그쪽에 있다.
 * 다만 서버 사이드 재검증 원칙에 따라 requireAdmin() 으로 한 번 더 확인한다.
 *
 * 쿼리스트링(status, q, from, to)을 getOrdersForExport 에 그대로 전달하므로,
 * 목록 화면과 동일한 필터로 내보낼 수 있다(화면 == CSV). UTF-8 BOM 을 붙여
 * Excel 이 한글을 깨지 않고 읽도록 한다.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/db/admin';
import { getOrdersForExport } from '@/lib/db/order';
import { ORDER_STATUSES } from '@/types/order';
import type { OrderStatus, OrderWithItems } from '@/types/order';

/** 상태 코드 → 한글 라벨 (관리자 목록 UI와 동일). */
const STATUS_LABELS: Record<OrderStatus, string> = {
  CREATED: '주문접수',
  PAID: '결제완료',
  IN_PRODUCTION: '제작중',
  SHIPPED: '배송중',
  DELIVERED: '배송완료',
  CANCELLED: '취소',
  REFUNDED: '환불',
};

const CSV_HEADERS = [
  '주문번호',
  '주문일시',
  '상태',
  '주문자명',
  '전화',
  '이메일',
  '우편번호',
  '배송지',
  '상품요약',
  '총수량',
  '결제금액',
  '택배사',
  '운송장번호',
] as const;

/** 유효한 OrderStatus 만 통과시키고 그 외(빈 값/'ALL' 등)는 null 로. */
function parseStatus(raw: string | null): OrderStatus | null {
  if (!raw) return null;
  return (ORDER_STATUSES as readonly string[]).includes(raw)
    ? (raw as OrderStatus)
    : null;
}

/**
 * CSV 필드 이스케이프 + 수식 인젝션 방어.
 *
 * 1) CSV injection(formula injection): 고객이 입력한 이름/주소 등이 `=`,`+`,`-`,`@`,
 *    탭/CR 로 시작하면 Excel·Sheets 가 수식으로 실행할 수 있다. 위험 문자로 시작하면
 *    앞에 작은따옴표(')를 붙여 텍스트로 강제한다(OWASP 권장).
 * 2) RFC 4180: 쉼표/큰따옴표/개행이 있으면 큰따옴표로 감싸고 내부 `"` 는 `""` 로.
 */
function csvField(value: string | number | null | undefined): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 한 주문을 CSV 한 행(셀 배열)으로 변환. */
function orderToRow(order: OrderWithItems): string[] {
  const totalQuantity = order.items.reduce((acc, item) => acc + item.quantity, 0);

  const itemSummary = order.items
    .map(
      (item) =>
        `${item.snapshot.productName} (${item.snapshot.sizeLabel}/${item.snapshot.colorLabel}) x${item.quantity}`,
    )
    .join(' | ');

  const address = `${order.shipping.addr1} ${order.shipping.addr2}`.trim();

  return [
    order.orderNo,
    order.createdAt,
    STATUS_LABELS[order.status],
    order.orderer.name,
    order.orderer.phone,
    order.orderer.email,
    order.shipping.zip,
    address,
    itemSummary,
    String(totalQuantity),
    String(order.totalPrice),
    order.courier ?? '',
    order.trackingNumber ?? '',
  ];
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Defense-in-depth: middleware already gates /api/admin/*, but we re-verify
  // the session server-side (cache()-wrapped, cheap). Never trust the gateway alone.
  try {
    await requireAdmin();
  } catch {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const filters = {
    status: parseStatus(params.get('status')),
    q: params.get('q'),
    from: params.get('from'),
    to: params.get('to'),
  };

  let orders: OrderWithItems[];
  try {
    orders = await getOrdersForExport(filters);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'admin_orders_export_failed',
        ctx: { message: err instanceof Error ? err.message : 'unknown' },
      }),
    );
    return new NextResponse('Export failed', { status: 500 });
  }

  const lines = [
    CSV_HEADERS.map(csvField).join(','),
    ...orders.map((order) => orderToRow(order).map(csvField).join(',')),
  ];
  // CRLF row terminator (RFC 4180) + leading UTF-8 BOM so Excel detects UTF-8
  // and renders Korean without mojibake. ﻿ as an explicit escape (not a
  // literal invisible char) so a formatter can't silently strip it.
  const BOM = String.fromCharCode(0xfeff);
  const csv = BOM + lines.join('\r\n');

  const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
