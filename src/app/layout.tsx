import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FrameShop — 내 사진을 액자로',
  description: '사진을 액자에 미리 맞춰보고 주문하세요. 베이직 액자부터 프리미엄까지.',
};

/**
 * Root layout.
 *
 * Font strategy (Nike-aligned):
 *  - Display tier: Bebas Neue (Google Fonts, weight 400) — substitute for
 *    Nike Futura ND in 96px uppercase campaign headlines. Used only via
 *    the `.display-campaign` utility class.
 *  - UI tier: Pretendard Variable (self-hosted via @font-face in globals.css)
 *    — Korean-optimized workhorse for nav, body, buttons, captions.
 *
 * Bebas Neue is loaded here (not in globals.css) so the preconnect hint
 * fires before any CSS parse work.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
      </body>
    </html>
  );
}
