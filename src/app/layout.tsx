import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FrameShop — 내 사진을 액자로',
  description: '사진을 액자에 미리 맞춰보고 주문하세요. 베이직 액자부터 프리미엄까지.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
