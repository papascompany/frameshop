/**
 * SEO / metadata helpers — Phase 4-C
 *
 * Centralises all structured-data builders so individual page files
 * stay small and consistent. Import only what you need; tree-shaking
 * removes the rest in the edge runtime.
 */

import type { Metadata } from 'next';

// ── Site constants ────────────────────────────────────────────────────────────

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://frameshop.vercel.app';

export const DEFAULT_OG_IMAGE = `${SITE_URL}/opengraph-image`;

export const SITE_NAME = 'FrameShop';

// ── Page-level metadata builders ─────────────────────────────────────────────

export function buildProductMeta({
  id,
  name,
  description,
  thumbnailUrl,
}: {
  id: string;
  name: string;
  description?: string | null;
  thumbnailUrl?: string | null;
}): Metadata {
  const desc =
    description ?? `${name}로 당신의 사진을 작품으로 만들어 보세요.`;
  const image = thumbnailUrl ?? DEFAULT_OG_IMAGE;
  const url = `${SITE_URL}/product/${id}`;

  return {
    title: `${name} — 맞춤 액자`,
    description: desc,
    alternates: { canonical: `/product/${id}` },
    openGraph: {
      title: `${name} — 맞춤 액자 | ${SITE_NAME}`,
      description: desc,
      url,
      siteName: SITE_NAME,
      locale: 'ko_KR',
      type: 'website',
      images: [{ url: image, width: 1200, height: 630, alt: name }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} — 맞춤 액자 | ${SITE_NAME}`,
      description: desc,
      images: [image],
    },
  };
}

export function buildCatalogMeta({
  slug,
  title,
  eyebrow,
}: {
  slug: string;
  title: string;
  eyebrow: string;
}): Metadata {
  const desc = `FrameShop의 ${eyebrow} 컬렉션. 다양한 크기와 색상으로 당신의 사진을 담아보세요.`;
  const url = `${SITE_URL}/catalog/${slug}`;

  return {
    title: `${eyebrow} — 액자 카탈로그`,
    description: desc,
    alternates: { canonical: `/catalog/${slug}` },
    openGraph: {
      title: `${title} | ${SITE_NAME}`,
      description: desc,
      url,
      siteName: SITE_NAME,
      locale: 'ko_KR',
      type: 'website',
      images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: eyebrow }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${SITE_NAME}`,
      description: desc,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

// ── JSON-LD builders ──────────────────────────────────────────────────────────

export function buildOrganizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    description: '사진 액자 Print-on-Demand 플랫폼',
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      availableLanguage: 'Korean',
    },
  } as const;
}

export function buildWebSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/catalog/basic-frame?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  } as const;
}

export function buildProductJsonLd({
  id,
  name,
  description,
  imageUrl,
  lowPrice,
  highPrice,
}: {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  lowPrice: number;
  highPrice: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: description ?? name,
    image: imageUrl ?? DEFAULT_OG_IMAGE,
    brand: {
      '@type': 'Brand',
      name: SITE_NAME,
    },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'KRW',
      lowPrice: String(lowPrice),
      highPrice: String(highPrice),
      availability: 'https://schema.org/InStock',
      url: `${SITE_URL}/product/${id}`,
    },
  };
}

export function buildBreadcrumbJsonLd(
  items: Array<{ name: string; url: string }>,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function buildFaqJsonLd(
  items: Array<{ question: string; answer: string }>,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}
