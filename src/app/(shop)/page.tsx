import { Container } from '@/components/layout/Container';
import { ProductCard } from '@/components/ProductCard';
import {
  getCategories,
  getRepresentativeProducts,
} from '@/lib/db/catalog';
import { getActiveCurations } from '@/lib/db/curation';
import { safeHref } from '@/lib/safe-href';
import type {
  Curation,
  CategoryTreeNode,
  ProductListItem,
} from '@/types';

export default async function LandingPage() {
  // Guard against empty env (Phase 0 — no Supabase yet).
  let categories: CategoryTreeNode[] = [];
  let curations: Curation[] = [];
  let reps: Record<string, ProductListItem | null> = {};

  try {
    [categories, curations] = await Promise.all([
      getCategories(),
      getActiveCurations('all', new Date()),
    ]);
    reps = await getRepresentativeProducts(categories.map((c) => c.id));
  } catch (err) {
    console.warn('Landing data fetch failed:', err);
  }

  const banner = curations.find((c) => c.type === 'banner') ?? null;

  return (
    <>
      {banner ? <HeroBanner curation={banner} /> : null}

      <Container size="xl" className="py-8 md:py-12">
        <h1 className="text-xl md:text-2xl font-bold mb-4">카테고리</h1>

        {categories.length === 0 ? (
          <EmptyState message="곧 새로운 액자가 준비됩니다." />
        ) : (
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {categories.map((cat) => {
              const rep = reps[cat.id as unknown as string] ?? null;
              return (
                <li key={cat.id}>
                  {rep ? (
                    <ProductCard product={rep} />
                  ) : (
                    <a
                      href={`/catalog/${cat.slug}`}
                      className="block aspect-square bg-surface-muted border border-border rounded-card grid place-items-center text-sm"
                    >
                      {cat.name}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Container>
    </>
  );
}

function HeroBanner({ curation }: { curation: Curation }) {
  // Phase 1 — no payload type-narrowing in this server component; the JSON
  // is validated upstream by validateCurationPayload at admin write-time.
  // We still apply render-time guards (safeHref + safeImageUrl) as a
  // defense-in-depth layer against poisoned legacy rows (P1-07).
  const payload = curation.payload as { imageUrl?: string; title?: string; link?: string };
  const imageUrl = safeImageUrl(payload.imageUrl);
  if (!imageUrl) return null;
  const href = safeHref(payload.link);
  return (
    <a
      href={href}
      className="block w-full bg-header text-header-fg"
      aria-label={curation.title ?? '메인 배너'}
    >
      <div
        className="aspect-[4/5] md:aspect-[16/6] bg-cover bg-center"
        style={{ backgroundImage: `url(${encodeURI(imageUrl)})` }}
        role="img"
        aria-label={curation.title ?? ''}
      />
    </a>
  );
}

/**
 * Returns the URL only if it parses as `http(s):`, otherwise `null`.
 * Mirrors `safeHref` semantics but the caller decides what to do when null.
 */
function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url;
    }
  } catch {
    // fall through
  }
  return null;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 text-center text-muted-fg text-sm">{message}</div>
  );
}
