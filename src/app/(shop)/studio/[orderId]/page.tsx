import { Container } from '@/components/layout/Container';
import { getProductDetail, getProductOptions } from '@/lib/db/product';
import { asBrand } from '@/types/common';
import type { ProductId } from '@/types/common';
import { StudioClient } from './StudioClient';

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ productId?: string }>;
}) {
  const { orderId } = await params;
  const { productId } = await searchParams;

  if (!productId) {
    return (
      <Container size="md" className="py-10">
        <p className="text-sm text-muted-fg">상품 정보가 없습니다.</p>
      </Container>
    );
  }

  let detail: Awaited<ReturnType<typeof getProductDetail>> = null;
  let options: Awaited<ReturnType<typeof getProductOptions>> | null = null;

  try {
    [detail, options] = await Promise.all([
      getProductDetail(asBrand<ProductId>(productId)),
      getProductOptions(asBrand<ProductId>(productId)),
    ]);
  } catch (err) {
    console.warn('studio data fetch failed:', err);
  }

  if (!detail || !options) {
    return (
      <Container size="md" className="py-10">
        <p className="text-sm text-muted-fg">상품을 불러올 수 없습니다.</p>
      </Container>
    );
  }

  return (
    <StudioClient
      sessionId={orderId}
      productDetail={detail}
      options={options}
    />
  );
}
