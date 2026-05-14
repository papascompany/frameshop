import type { MetadataRoute } from 'next';
import { getProductsByCategory } from '@/lib/db/catalog';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://frameshop.vercel.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/catalog/basic-frame`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/catalog/premium-frame`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/catalog/canvas`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/cart`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/checkout`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  // Dynamic product pages
  let productPages: MetadataRoute.Sitemap = [];
  try {
    const slugs = ['basic-frame', 'premium-frame', 'canvas'];
    const results = await Promise.all(
      slugs.map((slug) =>
        getProductsByCategory(slug, { page: 1, pageSize: 100 }),
      ),
    );
    const allProducts = results.flatMap((r) => r.items);

    productPages = allProducts.map((product) => ({
      url: `${SITE_URL}/product/${product.id}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));
  } catch (err) {
    console.warn('sitemap: 상품 조회 실패, 정적 페이지만 포함합니다:', err);
  }

  return [...staticPages, ...productPages];
}
