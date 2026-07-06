import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Container } from '@/components/layout/Container';
import { PriceTag } from '@/components/PriceTag';
import { Button } from '@/components/ui/Button';
import { getProductDetail, getProductOptions } from '@/lib/db/product';
import { asBrand } from '@/types/common';
import type { ProductId } from '@/types/common';
import { StartEditorButton, StartMultiEditorButton } from './StartEditorButton';
import Image from 'next/image';
import {
  buildProductMeta,
  buildProductJsonLd,
  buildBreadcrumbJsonLd,
  SITE_URL,
} from '@/lib/seo/metadata';
import { safeJsonLd } from '@/lib/seo/safe-json-ld';
import { getTranslations } from 'next-intl/server';

/**
 * Product detail — ISR cached for 5 minutes.
 *
 * Hot product pages benefit from a warm cache on Vercel's edge: the
 * Supabase query that joins images + variants is the heaviest path in
 * the catalog flow. 5 minutes is enough latency for admins to see edits
 * while keeping `/product/[id]` near-instant for repeat shoppers.
 */
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  let detail: Awaited<ReturnType<typeof getProductDetail>> = null;
  try {
    detail = await getProductDetail(asBrand<ProductId>(id));
  } catch {
    // silently swallow — generateMetadata returning {} is fine
  }
  if (!detail) return {};

  const thumbnailUrl =
    detail.images.thumbnail[0]?.imageUrl ??
    detail.images.gallery[0]?.imageUrl ??
    null;

  return buildProductMeta({
    id,
    name: detail.product.name,
    description: detail.product.tagline ?? detail.product.description,
    thumbnailUrl,
  });
}

export async function generateStaticParams(): Promise<{ id: string }[]> {
  // Returns empty array so build succeeds even without DB access.
  // ISR will generate the pages on first request.
  try {
    const { getProductsByCategory } = await import('@/lib/db/catalog');
    const slugs = ['basic-frame', 'premium-frame', 'canvas'];
    const results = await Promise.all(
      slugs.map((slug) =>
        getProductsByCategory(slug, { page: 1, pageSize: 100 }),
      ),
    );
    return results
      .flatMap((r) => r.items)
      .map((p) => ({ id: p.id as string }));
  } catch {
    return [];
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let detail: Awaited<ReturnType<typeof getProductDetail>> = null;
  let options: Awaited<ReturnType<typeof getProductOptions>> | null = null;
  try {
    [detail, options] = await Promise.all([
      getProductDetail(asBrand<ProductId>(id)),
      getProductOptions(asBrand<ProductId>(id)).catch(() => null),
    ]);
  } catch (err) {
    console.warn('getProductDetail failed:', err);
  }
  if (!detail) notFound();

  const t = await getTranslations('product');

  // #11: size → starting price chips so the shopper sees options + price
  // BEFORE entering the editor (no commit blind).
  const sizePrices = options
    ? options.sizes
        .map((s) => {
          const prices = Object.values(options.variantsByKey)
            .filter((v) => v.sizeCode === s.code)
            .map((v) => v.price);
          return prices.length > 0
            ? { code: s.code, label: s.label, from: Math.min(...prices) }
            : null;
        })
        .filter((x): x is { code: string; label: string; from: number } => x !== null)
    : [];

  const hero = detail.images.gallery[0] ?? detail.images.thumbnail[0] ?? null;
  const thumbnailUrl =
    detail.images.thumbnail[0]?.imageUrl ??
    detail.images.gallery[0]?.imageUrl ??
    null;

  const productJsonLd = buildProductJsonLd({
    id,
    name: detail.product.name,
    description: detail.product.tagline ?? detail.product.description,
    imageUrl: thumbnailUrl,
    lowPrice: detail.startingPrice,
    highPrice: detail.startingPrice,
  });

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: '홈', url: SITE_URL },
    { name: '베이직 액자', url: `${SITE_URL}/catalog/basic-frame` },
    { name: detail.product.name, url: `${SITE_URL}/product/${id}` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
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
                {t('imagePrepairing')}
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

            {/* #11: 사이즈별 시작가 — 진입 전 옵션/가격 확인 */}
            {sizePrices.length > 0 ? (
              <div>
                <p className="text-xs text-muted-fg mb-1.5">사이즈별 가격</p>
                <ul className="flex flex-wrap gap-1.5">
                  {sizePrices.map((s) => (
                    <li
                      key={s.code}
                      className="inline-flex items-baseline gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs"
                    >
                      <span className="font-medium">{s.label}</span>
                      <span className="text-muted-fg tabular-nums">
                        {s.from.toLocaleString('ko-KR')}원~
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-sm leading-relaxed whitespace-pre-line">
              {detail.product.description}
            </p>

            {detail.defaultVariantId ? (
              <div className="flex flex-col gap-2">
                <StartEditorButton productId={detail.product.id} />
                {/* FS-P1-03: 확장형(멀티포토) 편집기 보조 CTA */}
                <StartMultiEditorButton productId={detail.product.id} />
              </div>
            ) : (
              <Button variant="primary" size="lg" fullWidth disabled>
                {t('optionPrepairing')}
              </Button>
            )}
          </div>
        </div>

        {/* Guide images */}
        {detail.images.guide.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-lg font-bold mb-4">{t('productionGuide')}</h2>
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
    </>
  );
}
