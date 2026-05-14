import type { MetadataRoute } from 'next';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://frameshop.vercel.app';

const DISALLOWED = ['/admin', '/api', '/studio', '/checkout', '/payment', '/account'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default — allow everything except private paths
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED,
      },
      // AI / LLM crawlers — explicitly allow so they can index the site
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'Claude-Web', allow: '/' },
      { userAgent: 'anthropic-ai', allow: '/' },
      { userAgent: 'Googlebot', allow: '/' },
      // Naver crawler
      { userAgent: 'Yeti', allow: '/' },
      // Kakao link scraper
      { userAgent: 'Kakaotalk-Scrap', allow: '/' },
      { userAgent: 'Bingbot', allow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
