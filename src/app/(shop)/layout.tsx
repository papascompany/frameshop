import type { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { MobileNav } from '@/components/layout/MobileNav';
import { Footer } from '@/components/layout/Footer';

/**
 * Shop layout: dark sticky header + content + footer + mobile tab bar.
 * The `pb-16 md:pb-0` reserves space so the bottom nav doesn't cover content.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex-1 pb-16 md:pb-0">{children}</main>
      <Footer />
      <MobileNav />
    </>
  );
}
