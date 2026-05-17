'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Props = {
  onMenuClick: () => void;
};

const PAGE_TITLES: Record<string, string> = {
  '/admin': '대시보드',
  '/admin/products': '상품 관리',
  '/admin/frames': '프레임 관리',
  '/admin/options': '옵션 관리',
  '/admin/orders': '주문 관리',
  '/admin/reviews': '리뷰 관리',
  '/admin/curation': '큐레이션',
  '/admin/artworks': '명화 관리',
  '/admin/shipping': '배송 설정',
  '/admin/settings': '설정',
};

function getPageTitle(pathname: string): string {
  // Exact match first
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  // Prefix match (e.g. /admin/orders/[id])
  for (const [key, label] of Object.entries(PAGE_TITLES)) {
    if (key !== '/admin' && pathname.startsWith(key)) return label;
  }
  return 'Admin';
}

const IconMenu = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden>
    <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" clipRule="evenodd" />
  </svg>
);

const IconExternalLink = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden>
    <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" clipRule="evenodd" />
    <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" clipRule="evenodd" />
  </svg>
);

export function AdminTopBar({ onMenuClick }: Props) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header className="h-14 flex items-center px-4 md:px-6 border-b border-hairline bg-canvas shrink-0">
      {/* Mobile: hamburger */}
      <button
        type="button"
        onClick={onMenuClick}
        className="md:hidden p-1.5 -ml-1.5 rounded hover:bg-soft-cloud transition-colors text-ink"
        aria-label="메뉴 열기"
      >
        <IconMenu />
      </button>

      {/* Mobile: center title */}
      <span className="flex-1 md:hidden text-center text-sm font-semibold text-ink">
        FrameShop Admin
      </span>

      {/* Desktop: page title */}
      <h1 className="hidden md:block text-base font-semibold text-ink">
        {title}
      </h1>

      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/"
          className="hidden md:inline-flex items-center gap-1.5 text-sm text-mute hover:text-ink transition-colors"
        >
          사이트 보기
          <IconExternalLink />
        </Link>
        {/* Mobile: icon-only */}
        <Link
          href="/"
          className="md:hidden p-1.5 rounded hover:bg-soft-cloud transition-colors text-mute hover:text-ink"
          aria-label="사이트 보기"
        >
          <IconExternalLink />
        </Link>
      </div>
    </header>
  );
}
