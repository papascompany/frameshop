import type { Metadata } from 'next';
import './globals.css';
import { fontDisplay, fontSans } from '@/lib/fonts';
import {
  SITE_URL,
  SITE_NAME,
  DEFAULT_OG_IMAGE,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
} from '@/lib/seo/metadata';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'FrameShop — 사진을 작품으로',
    template: `%s | ${SITE_NAME}`,
  },
  description:
    '풍경, 가족, 명화. 당신의 한 장을 액자에 담아 거실의 작품으로 만들어 드립니다. 온라인 주문, 고화질 인쇄, 빠른 배송.',
  keywords: [
    '액자',
    '사진 액자',
    '맞춤 액자',
    '인화',
    '프린트',
    '포토 액자',
    '결혼 사진 액자',
    '명화 액자',
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: 'FrameShop — 사진을 작품으로',
    description:
      '풍경, 가족, 명화. 당신의 한 장을 액자에 담아 거실의 작품으로 만들어 드립니다.',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'FrameShop — 사진을 작품으로',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FrameShop — 사진을 작품으로',
    description:
      '풍경, 가족, 명화. 당신의 한 장을 액자에 담아 거실의 작품으로 만들어 드립니다.',
    images: [DEFAULT_OG_IMAGE],
  },
  robots: { index: true, follow: true },
  alternates: { canonical: SITE_URL },
  verification: {
    // google: 'google-site-verification-code', // 실제 코드 입력 후 주석 해제
    // other: { 'naver-site-verification': 'naver-site-verification-code' },
  },
};

/**
 * Root layout.
 *
 *  Font strategy (self-hosted, render-blocking-free):
 *   - Display tier (`--font-display`): Bebas Neue via `next/font/google`
 *     for campaign headlines (.display-campaign utility).
 *   - UI tier (`--font-sans`): Pretendard Variable via `next/font/local`,
 *     shipped from `public/fonts/`. Replaces the prior jsdelivr CDN that
 *     added 200–500 ms of first-paint latency on Korean mobile networks.
 *
 *  Both font CSS variables are exposed on `<html>` so Tailwind utilities
 *  resolve them through globals.css `@theme inline`.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const orgJsonLd = buildOrganizationJsonLd();
  const siteJsonLd = buildWebSiteJsonLd();
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`h-full antialiased ${fontDisplay.variable} ${fontSans.variable}`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
      </body>
    </html>
  );
}
