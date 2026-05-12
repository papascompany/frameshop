import { Container } from '@/components/layout/Container';
import { ProductCard } from '@/components/ProductCard';
import { getProductsByCategory } from '@/lib/db/catalog';
import type { ProductListResult } from '@/types';

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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

  return (
    <Container size="xl" className="py-6 md:py-10">
      <h1 className="text-xl md:text-2xl font-bold mb-4">{slug}</h1>
      {result.items.length === 0 ? (
        <div className="py-12 text-center text-muted-fg text-sm">
          곧 새로운 상품이 등록됩니다.
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {result.items.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
