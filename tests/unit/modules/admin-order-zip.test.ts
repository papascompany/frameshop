/**
 * GET /api/admin/orders/[id]/zip (FS-EC-03) 단위 테스트.
 *
 * - requireAdmin 이중 게이트(미들웨어와 별개로 핸들러에서 재검증).
 * - print_file_url 0건 → 404, 전부 실패 → 502.
 * - 개별 fetch 실패는 스킵하고 manifest.txt 에 기록(STORE 무압축 ZIP).
 * - SSRF 심층방어(FS-EC P2-2): Supabase Storage origin 외 URL 은 fetch 없이
 *   스킵 + manifest 기록. 픽스처 URL 은 테스트 env 의
 *   NEXT_PUBLIC_SUPABASE_URL(https://example.supabase.co) origin 을 쓴다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type { OrderItem, OrderWithItems } from '@/types/order';
import { asBrand } from '@/types/common';
import type { OrderId } from '@/types/common';

vi.mock('@/lib/db/admin', () => ({
  requireAdmin: vi.fn(async () => ({
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'admin',
  })),
}));

vi.mock('@/lib/db/order', () => ({
  getOrder: vi.fn(),
}));

import { GET } from '@/app/api/admin/orders/[id]/zip/route';
import { requireAdmin } from '@/lib/db/admin';
import { getOrder } from '@/lib/db/order';

const requireAdminMock = vi.mocked(requireAdmin);
const getOrderMock = vi.mocked(getOrder);

function makeItem(name: string, printFileUrl: string | null): OrderItem {
  return {
    id: `item-${name}` as unknown as OrderItem['id'],
    orderId: asBrand<OrderId>('order-id-1'),
    snapshot: {
      productId: 'p-1' as unknown as OrderItem['snapshot']['productId'],
      variantId: 'v-1' as unknown as OrderItem['snapshot']['variantId'],
      productName: name,
      options: {} as OrderItem['snapshot']['options'],
      sizeLabel: 'A4',
      colorLabel: '오크',
      unitPrice: 15000,
    },
    photoUrl: 'https://cdn.example.com/photo.jpg',
    cropTransform: {} as OrderItem['cropTransform'],
    printFileUrl,
    quantity: 1,
    price: 15000,
  };
}

function makeOrder(items: OrderItem[]): OrderWithItems {
  return {
    id: asBrand<OrderId>('order-id-1'),
    orderNo: '20260703-0001' as unknown as OrderWithItems['orderNo'],
    userId: null,
    status: 'PAID',
    totalPrice: 30000,
    shippingFee: 3000,
    shippingMethod: 'STANDARD' as unknown as OrderWithItems['shippingMethod'],
    paymentId: null,
    trackingNumber: null,
    courier: null,
    orderer: { name: '홍길동', phone: '010-1234-5678', email: 'hong@example.com' },
    shipping: {
      name: '홍길동',
      phone: '010-1234-5678',
      zip: '06234',
      addr1: '서울시 강남구 테헤란로 123',
      addr2: '101호',
      memo: '',
    },
    createdAt: '2026-07-03T00:00:00Z',
    paidAt: '2026-07-03T01:00:00Z',
    shippedAt: null,
    items,
  };
}

function callRoute(id = 'order-id-1'): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/orders/${id}/zip`), {
    params: Promise.resolve({ id }),
  });
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).buffer;

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'admin',
  } as never);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('접근 제어 / 존재 검증', () => {
  it('requireAdmin 실패 시 403 — 미들웨어와 별개의 이중 게이트', async () => {
    requireAdminMock.mockRejectedValue(new Error('FORBIDDEN'));

    const res = await callRoute();

    expect(res.status).toBe(403);
    expect(getOrderMock).not.toHaveBeenCalled();
  });

  it('인쇄 파일이 하나도 없으면 404 JSON', async () => {
    getOrderMock.mockResolvedValue(makeOrder([makeItem('액자', null)]));

    const res = await callRoute();

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('인쇄 파일');
  });
});

describe('ZIP 생성', () => {
  it('개별 fetch 실패는 스킵하고 manifest.txt 에 기록한다', async () => {
    getOrderMock.mockResolvedValue(
      makeOrder([
        makeItem('오크액자', 'https://example.supabase.co/storage/v1/prints/a.jpg'),
        makeItem('월넛액자', 'https://example.supabase.co/storage/v1/prints/b.jpg'),
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).endsWith('a.jpg')) {
          return { ok: true, status: 200, arrayBuffer: async () => JPEG_BYTES } as unknown as Response;
        }
        return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
      }),
    );

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(res.headers.get('Content-Disposition')).toContain('20260703-0001_print.zip');

    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const names = Object.keys(zip.files);
    // 성공한 1건 + manifest.txt, 실패한 2번 항목은 없음.
    expect(names).toHaveLength(2);
    expect(names.some((n) => n.startsWith('01_') && n.endsWith('.jpg'))).toBe(true);
    expect(names).toContain('manifest.txt');

    const manifest = await zip.files['manifest.txt'].async('string');
    expect(manifest).toContain('[OK]');
    expect(manifest).toContain('[SKIP]');
    expect(manifest).toContain('HTTP 500');
  });

  it('후보는 있으나 전부 실패하면 502', async () => {
    getOrderMock.mockResolvedValue(
      makeOrder([
        makeItem('오크액자', 'https://example.supabase.co/storage/v1/prints/a.jpg'),
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const res = await callRoute();

    expect(res.status).toBe(502);
    const logged = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('admin_order_zip_all_failed');
  });

  it('Supabase Storage origin 이 아닌 URL 은 fetch 없이 스킵하고 manifest 에 기록한다(SSRF 심층방어)', async () => {
    getOrderMock.mockResolvedValue(
      makeOrder([
        makeItem('오크액자', 'https://example.supabase.co/storage/v1/prints/a.jpg'),
        makeItem('월넛액자', 'https://169.254.169.254/latest/meta-data'),
      ]),
    );
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => JPEG_BYTES,
    }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const res = await callRoute();

    expect(res.status).toBe(200);
    // 서버 fetch 는 허용 origin 1건만 — 메타데이터 엔드포인트로는 나가지 않는다.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('example.supabase.co');

    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const manifest = await zip.files['manifest.txt'].async('string');
    expect(manifest).toContain('[SKIP]');
    expect(manifest).toContain('origin not allowed');
    const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(warned).toContain('origin_not_allowed');
  });
});
