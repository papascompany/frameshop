import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-header text-header-fg px-4 py-3 flex items-center gap-4">
        <Link href="/admin" className="font-semibold">FrameShop · Admin</Link>
        <nav className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/admin/products">상품</Link>
          <Link href="/admin/frames">프레임</Link>
          <Link href="/admin/options">옵션</Link>
          <Link href="/admin/orders">주문</Link>
          <Link href="/admin/curation">큐레이션</Link>
          <Link href="/admin/artworks">명화</Link>
          <Link href="/admin/shipping">배송 설정</Link>
          <Link href="/admin/settings">설정</Link>
        </nav>
      </header>
      <main className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
