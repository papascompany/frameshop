'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

type NavSection = {
  title?: string;
  items: NavItem[];
};

// Inline SVG icons (heroicons style, 20x20 viewBox)
const IconGrid = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" clipRule="evenodd" />
  </svg>
);

const IconBox = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path d="M10.362 1.093a.75.75 0 0 0-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925ZM18 6.443l-7.25 3.997v7.474l6.533-3.003A.75.75 0 0 0 18 14.25V6.443ZM2 14.25v-7.807L9.25 10.44v7.474L2.717 14.91A.75.75 0 0 1 2 14.25Z" />
  </svg>
);

const IconFrame = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path fillRule="evenodd" d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1H6Zm0 2.5a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1H6Zm0 2.5a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1H6Zm0 2.5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1H6Z" clipRule="evenodd" />
  </svg>
);

const IconSliders = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path d="M17 2.75a.75.75 0 0 0-1.5 0v8.5H4.75a.75.75 0 0 0 0 1.5H15.5v3.5a.75.75 0 0 0 1.5 0V2.75ZM3 6.25a.75.75 0 0 0 1.5 0V2.75a.75.75 0 0 0-1.5 0V6.25Zm.75 2A2.25 2.25 0 0 0 1.5 10.5a2.25 2.25 0 0 0 2.25 2.25A2.25 2.25 0 0 0 6 10.5 2.25 2.25 0 0 0 3.75 8.25ZM3.75 9.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm12.5 3.75A2.25 2.25 0 0 0 14 15.75a2.25 2.25 0 0 0 2.25 2.25A2.25 2.25 0 0 0 18.5 15.75a2.25 2.25 0 0 0-2.25-2.25Zm0 1.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
  </svg>
);

const IconList = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" clipRule="evenodd" />
  </svg>
);

const IconStar = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clipRule="evenodd" />
  </svg>
);

const IconSparkles = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.632l2.051-.684a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.949 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
  </svg>
);

const IconPainting = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm2.25-.75a.75.75 0 0 0-.75.75v6.27l3.693-3.03a.75.75 0 0 1 .964.026l4.004 3.754 1.242-.836a.75.75 0 0 1 .894.062l2.953 2.637V5.25a.75.75 0 0 0-.75-.75H3.25Zm13.5 10.5a.75.75 0 0 0 .75-.75v-.358l-3.165-2.824-1.259.847a.75.75 0 0 1-.916-.062l-3.985-3.73-3.675 3.016V14.75a.75.75 0 0 0 .75.75h11.5Z" clipRule="evenodd" />
  </svg>
);

const IconTruck = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path d="M6.5 3A1.5 1.5 0 0 0 5 4.5H3a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h.5a2.5 2.5 0 0 0 5 0h3a2.5 2.5 0 0 0 5 0H17a2 2 0 0 0 2-2V9.485a2 2 0 0 0-.586-1.414l-1.899-1.9A2 2 0 0 0 15.101 5.6H14A1.5 1.5 0 0 0 12.5 4H8A1.5 1.5 0 0 0 6.5 3Zm7 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm6-6.5v2h2.101a.5.5 0 0 1 .354.146l1.899 1.9A.5.5 0 0 1 17 10.015V11h-1V9.485a1 1 0 0 0-.293-.707L13.808 6.88A1 1 0 0 0 13.101 6.6H13.5Z" />
  </svg>
);

const IconGear = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .205 1.251l-1.18 2.044a1 1 0 0 1-1.186.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.205-1.251l1.18-2.044a1 1 0 0 1 1.186-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
  </svg>
);

const IconArrowLeft = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden>
    <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
  </svg>
);

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/admin', label: '대시보드', icon: <IconGrid /> },
    ],
  },
  {
    title: '상품 관리',
    items: [
      { href: '/admin/products', label: '상품', icon: <IconBox /> },
      { href: '/admin/frames', label: '프레임', icon: <IconFrame /> },
      { href: '/admin/options', label: '옵션', icon: <IconSliders /> },
    ],
  },
  {
    title: '운영',
    items: [
      { href: '/admin/orders', label: '주문', icon: <IconList /> },
      { href: '/admin/reviews', label: '리뷰', icon: <IconStar /> },
      { href: '/admin/curation', label: '큐레이션', icon: <IconSparkles /> },
      { href: '/admin/artworks', label: '명화', icon: <IconPainting /> },
    ],
  },
  {
    title: '설정',
    items: [
      { href: '/admin/shipping', label: '배송 설정', icon: <IconTruck /> },
      { href: '/admin/settings', label: '설정', icon: <IconGear /> },
    ],
  },
];

type Props = {
  open?: boolean;
  onClose?: () => void;
};

export function AdminSidebar({ open, onClose }: Props) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10">
        <span className="text-canvas font-bold text-base tracking-tight leading-none">
          FrameShop
        </span>
        <span className="text-[10px] font-semibold tracking-widest text-stone bg-white/10 px-1.5 py-0.5 rounded">
          ADMIN
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} className={cn(si > 0 && 'mt-4')}>
            {section.title ? (
              <p className="px-2 mb-1 text-[10px] font-semibold tracking-widest uppercase text-stone/60">
                {section.title}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-[8px] transition-colors duration-150',
                        active
                          ? 'bg-canvas text-ink'
                          : 'text-stone hover:bg-charcoal hover:text-canvas',
                      )}
                    >
                      <span className={cn(active ? 'text-ink' : 'text-stone')}>
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-3 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 text-sm text-stone hover:text-canvas transition-colors rounded-[8px] hover:bg-charcoal"
        >
          <IconArrowLeft />
          사이트 보기
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: fixed sidebar */}
      <aside className="hidden md:flex flex-col w-[220px] shrink-0 bg-ink min-h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile: drawer overlay */}
      {open ? (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={onClose}
            aria-hidden
          />
          {/* Drawer */}
          <aside className="fixed inset-y-0 left-0 z-50 flex flex-col w-[220px] bg-ink md:hidden">
            {sidebarContent}
          </aside>
        </>
      ) : null}
    </>
  );
}
