import type { Metadata } from 'next';
import './globals.css';
import { fontDisplay, fontSans } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'FrameShop — 사진을 작품으로',
  description:
    '풍경, 가족, 명화. 당신의 한 장을 액자에 담아 거실의 작품으로 만들어 드립니다.',
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
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`h-full antialiased ${fontDisplay.variable} ${fontSans.variable}`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
      </body>
    </html>
  );
}
