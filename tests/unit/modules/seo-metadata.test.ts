/**
 * SEO metadata helpers — unit tests (Phase 4-C).
 *
 * Verifies that every JSON-LD builder emits the required Schema.org fields
 * so that Google, Naver, and AI crawlers can parse them correctly.
 */

import { describe, expect, it } from 'vitest';
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  buildProductJsonLd,
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
  buildProductMeta,
  buildCatalogMeta,
  SITE_URL,
} from '@/lib/seo/metadata';

// ── 1. buildOrganizationJsonLd ───────────────────────────────────────────────

describe('buildOrganizationJsonLd', () => {
  it('includes @context and @type Organization', () => {
    const result = buildOrganizationJsonLd();
    expect(result['@context']).toBe('https://schema.org');
    expect(result['@type']).toBe('Organization');
  });

  it('includes name and url', () => {
    const result = buildOrganizationJsonLd();
    expect(result.name).toBe('FrameShop');
    expect(result.url).toBe(SITE_URL);
  });

  it('includes a contactPoint with Korean language', () => {
    const result = buildOrganizationJsonLd();
    expect(result.contactPoint.availableLanguage).toBe('Korean');
  });
});

// ── 2. buildWebSiteJsonLd ────────────────────────────────────────────────────

describe('buildWebSiteJsonLd', () => {
  it('includes @type WebSite', () => {
    const result = buildWebSiteJsonLd();
    expect(result['@type']).toBe('WebSite');
  });

  it('has a SearchAction potentialAction', () => {
    const result = buildWebSiteJsonLd();
    expect(result.potentialAction['@type']).toBe('SearchAction');
  });

  it('SearchAction target urlTemplate contains search_term_string', () => {
    const result = buildWebSiteJsonLd();
    expect(result.potentialAction.target.urlTemplate).toContain(
      '{search_term_string}',
    );
  });
});

// ── 3. buildProductJsonLd ────────────────────────────────────────────────────

describe('buildProductJsonLd', () => {
  const BASE = {
    id: 'prod-1',
    name: '베이직 액자',
    description: '인기 액자',
    imageUrl: 'https://example.com/image.jpg',
    lowPrice: 4800,
    highPrice: 39000,
  };

  it('includes required @context and @type Product', () => {
    const result = buildProductJsonLd(BASE);
    expect(result['@context']).toBe('https://schema.org');
    expect(result['@type']).toBe('Product');
  });

  it('includes AggregateOffer with KRW currency', () => {
    const result = buildProductJsonLd(BASE);
    expect(result.offers['@type']).toBe('AggregateOffer');
    expect(result.offers.priceCurrency).toBe('KRW');
  });

  it('stringifies lowPrice and highPrice', () => {
    const result = buildProductJsonLd(BASE);
    expect(result.offers.lowPrice).toBe('4800');
    expect(result.offers.highPrice).toBe('39000');
  });

  it('sets availability to InStock', () => {
    const result = buildProductJsonLd(BASE);
    expect(result.offers.availability).toBe(
      'https://schema.org/InStock',
    );
  });

  it('offer url contains the product id', () => {
    const result = buildProductJsonLd(BASE);
    expect(result.offers.url).toContain('prod-1');
  });

  it('falls back to DEFAULT_OG_IMAGE when no imageUrl', () => {
    const result = buildProductJsonLd({ ...BASE, imageUrl: null });
    expect(result.image).toContain('opengraph-image');
  });
});

// ── 4. buildBreadcrumbJsonLd ─────────────────────────────────────────────────

describe('buildBreadcrumbJsonLd', () => {
  const ITEMS = [
    { name: '홈', url: 'https://frameshop.vercel.app' },
    { name: '베이직 액자', url: 'https://frameshop.vercel.app/catalog/basic-frame' },
    { name: '상품명', url: 'https://frameshop.vercel.app/product/p-1' },
  ];

  it('includes @type BreadcrumbList', () => {
    const result = buildBreadcrumbJsonLd(ITEMS);
    expect(result['@type']).toBe('BreadcrumbList');
  });

  it('assigns correct position to each item (1-based)', () => {
    const result = buildBreadcrumbJsonLd(ITEMS);
    expect(result.itemListElement[0].position).toBe(1);
    expect(result.itemListElement[1].position).toBe(2);
    expect(result.itemListElement[2].position).toBe(3);
  });

  it('maps name and item (url) correctly', () => {
    const result = buildBreadcrumbJsonLd(ITEMS);
    expect(result.itemListElement[0].name).toBe('홈');
    expect(result.itemListElement[0].item).toBe(
      'https://frameshop.vercel.app',
    );
  });
});

// ── 5. buildFaqJsonLd ────────────────────────────────────────────────────────

describe('buildFaqJsonLd', () => {
  const FAQ = [
    { question: '배송은 얼마나 걸리나요?', answer: '1~3 영업일' },
    { question: '환불되나요?', answer: '제작 전 가능' },
  ];

  it('includes @type FAQPage', () => {
    const result = buildFaqJsonLd(FAQ);
    expect(result['@type']).toBe('FAQPage');
  });

  it('maps every question to a Question entity', () => {
    const result = buildFaqJsonLd(FAQ);
    expect(result.mainEntity).toHaveLength(2);
    expect(result.mainEntity[0]['@type']).toBe('Question');
  });

  it('includes acceptedAnswer with Answer @type', () => {
    const result = buildFaqJsonLd(FAQ);
    expect(result.mainEntity[0].acceptedAnswer['@type']).toBe('Answer');
    expect(result.mainEntity[0].acceptedAnswer.text).toBe('1~3 영업일');
  });

  it('preserves question name', () => {
    const result = buildFaqJsonLd(FAQ);
    expect(result.mainEntity[1].name).toBe('환불되나요?');
  });
});

// ── 6. buildProductMeta ──────────────────────────────────────────────────────

describe('buildProductMeta', () => {
  it('title contains product name', () => {
    const meta = buildProductMeta({ id: 'x', name: '프리미엄 액자' });
    expect(meta.title as string).toContain('프리미엄 액자');
  });

  it('sets canonical alternates', () => {
    const meta = buildProductMeta({ id: 'abc', name: '액자' });
    expect((meta.alternates as { canonical?: string })?.canonical).toContain('abc');
  });

  it('openGraph images has width 1200 and height 630', () => {
    const meta = buildProductMeta({
      id: 'x',
      name: '액자',
      thumbnailUrl: 'https://example.com/thumb.jpg',
    });
    const images = (meta.openGraph as { images?: Array<{ width: number; height: number }> })?.images;
    expect(Array.isArray(images) && images.length > 0).toBe(true);
    if (Array.isArray(images) && images.length > 0) {
      expect(images[0].width).toBe(1200);
      expect(images[0].height).toBe(630);
    }
  });
});

// ── 7. buildCatalogMeta ──────────────────────────────────────────────────────

describe('buildCatalogMeta', () => {
  it('title includes eyebrow', () => {
    const meta = buildCatalogMeta({
      slug: 'basic-frame',
      title: 'BASIC FRAMES',
      eyebrow: '베이직 액자',
    });
    expect(meta.title as string).toContain('베이직 액자');
  });

  it('canonical alternates includes slug', () => {
    const meta = buildCatalogMeta({
      slug: 'premium-frame',
      title: 'PREMIUM',
      eyebrow: '프리미엄',
    });
    expect((meta.alternates as { canonical?: string })?.canonical).toContain('premium-frame');
  });
});
