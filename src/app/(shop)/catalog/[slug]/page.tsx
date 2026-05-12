import { Container } from '@/components/layout/Container';
import { ProductCard } from '@/components/ProductCard';
import { SectionHeader } from '@/components/marketing/SectionHeader';
import { getProductsByCategory } from '@/lib/db/catalog';
import type { ProductListResult } from '@/types';

/**
 * Catalog by category — ISR cached.
 *
 *  The product catalog changes a few times a day at most (admin edits in
 *  `/admin/products`). A 5-minute revalidate keeps the Supabase RTT off
 *  the menu-hop critical path while still letting admins see their
 *  changes within minutes. Use `revalidatePath('/catalog/...')` from the
 *  admin server action if you need an instant flush.
 */
export const revalidate = 300; // 5 minutes ISR

// Pretty Korean labels for the slug → page title mapping. Falls back to
// the raw slug if we haven't curated one yet.
const SLUG_LABELS: Record<string, { title: string; eyebrow: string }> = {
  'basic-frame': { title: 'BASIC FRAMES', eyebrow: '베이직 액자' },
  'premium-frame': { title: 'PREMIUM FRAMES', eyebrow: '프리미엄 액자' },
  canvas: { title: 'CANVAS PRINTS', eyebrow: '캔버스 프린트' },
};

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ theme?: string; size?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  let result: ProductListResult = {
    items: [],
    total: 0,
    hasMore: false,
    page: 1,
    pageSize: 20,
  };

  try {
    result = await getProductsByCategory(slug, { page: 1, pageSize: 20 });
  } catch (err) {
    console.warn('Catalog fetch failed:', err);
  }

  const label = SLUG_LABELS[slug] ?? { title: slug.toUpperCase(), eyebrow: slug };
  const themeLabel = sp.theme
    ? sp.theme === 'masterpiece'
      ? '명화 컬렉션'
      : sp.theme === 'landscape'
        ? '풍경 컬렉션'
        : sp.theme
    : null;

  return (
    <Container size="xl" className="py-8 md:py-12">
      <SectionHeader
        title={label.title}
        eyebrow={themeLabel ? `${label.eyebrow} · ${themeLabel}` : label.eyebrow}
      />
      {result.items.length === 0 ? (
        <div className="py-16 text-center">
          <p className="heading-lg text-ink mb-2">곧 새로운 상품이 등록됩니다</p>
          <p className="caption-md text-mute">
            관리자가 상품을 등록하면 자동으로 노출됩니다 (캐시 갱신 5분).
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
          {result.items.map((p, i) => (
            <li key={p.id}>
              <ProductCard
                product={p}
                lazyImage={i > 3}
                badge={i === 0 ? 'BEST' : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
