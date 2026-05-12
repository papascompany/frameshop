import { notFound } from 'next/navigation';
import { Container } from '@/components/layout/Container';
import { PriceTag } from '@/components/PriceTag';
import { Button } from '@/components/ui/Button';
import { getProductDetail } from '@/lib/db/product';
import { asBrand } from '@/types/common';
import type { ProductId } from '@/types/common';
import { StartEditorButton } from './StartEditorButton';
import Image from 'next/image';

/**
 * Product detail — ISR cached for 5 minutes.
 *
 * Hot product pages benefit from a warm cache on Vercel's edge: the
 * Supabase query that joins images + variants is the heaviest path in
 * the catalog flow. 5 minutes is enough latency for admins to see edits
 * while keeping `/product/[id]` near-instant for repeat shoppers.
 */
export const revalidate = 300;

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let detail: Awaited<ReturnType<typeof getProductDetail>> = null;
  try {
    detail = await getProductDetail(asBrand<ProductId>(id));
  } catch (err) {
    console.warn('getProductDetail failed:', err);
  }
  if (!detail) notFound();

  const hero = detail.images.gallery[0] ?? detail.images.thumbnail[0] ?? null;

  return (
    <Container size="lg" className="py-6 md:py-10">
      <div className="grid md:grid-cols-2 gap-6">
        {/* Gallery */}
        <div className="aspect-square bg-surface-muted relative">
          {hero ? (
            <Image
              src={hero.imageUrl}
              alt={hero.altText ?? detail.product.name}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
              priority
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-fg">
              이미지 준비 중
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-1">{detail.product.name}</h1>
            {detail.product.tagline ? (
              <p className="text-sm text-muted-fg">{detail.product.tagline}</p>
            ) : null}
          </div>

          <PriceTag amount={detail.startingPrice} showFrom variant="large" />

          <p className="text-sm leading-relaxed whitespace-pre-line">
            {detail.product.description}
          </p>

          {detail.defaultVariantId ? (
            <StartEditorButton productId={detail.product.id} />
          ) : (
            <Button variant="primary" size="lg" fullWidth disabled>
              옵션 준비 중
            </Button>
          )}
        </div>
      </div>

      {/* Guide images */}
      {detail.images.guide.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-lg font-bold mb-4">제작 가이드</h2>
          <div className="flex flex-col gap-4">
            {detail.images.guide.map((g) => (
              <div key={g.id} className="relative aspect-[4/3] bg-surface-muted">
                <Image
                  src={g.imageUrl}
                  alt={g.altText ?? '제작 가이드'}
                  fill
                  sizes="100vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Container>
  );
}
