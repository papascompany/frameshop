import Link from 'next/link';
import type { ReactNode } from 'react';
import { Container } from '@/components/layout/Container';
import { getTranslations } from 'next-intl/server';

/**
 * 마이페이지 레이아웃.
 * PC: 좌측 사이드바 + 우측 콘텐츠 (2컬럼)
 * 모바일: 단일 컬럼 (사이드바 위에 표시)
 */

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('account');

  const NAV_ITEMS = [
    { href: '/account/orders', label: t('orders') },
    { href: '/account/addresses', label: t('addresses') },
  ];

  return (
    <Container size="lg" className="py-8 md:py-12">
      <div className="md:grid md:grid-cols-[200px_1fr] md:gap-10">
        {/* 사이드바 */}
        <aside className="mb-6 md:mb-0">
          <h2 className="text-xs font-semibold text-muted-fg uppercase tracking-wider mb-3">
            {t('title')}
          </h2>
          <nav aria-label={t('title')}>
            <ul className="flex md:flex-col gap-2 flex-wrap">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block text-sm py-1.5 px-2 rounded hover:bg-soft-cloud transition-colors text-foreground hover:text-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* 콘텐츠 */}
        <main>
          {children}
        </main>
      </div>
    </Container>
  );
}
