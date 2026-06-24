import Link from 'next/link';
import { cn } from '@/lib/cn';
import { adminTileItems, type AdminNavKey } from '@/lib/admin/adminNav';

const IconBox = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path d="M10.362 1.093a.75.75 0 0 0-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925ZM18 6.443l-7.25 3.997v7.474l6.533-3.003A.75.75 0 0 0 18 14.25V6.443ZM2 14.25v-7.807L9.25 10.44v7.474L2.717 14.91A.75.75 0 0 1 2 14.25Z" />
  </svg>
);

const IconFrame = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path fillRule="evenodd" d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1H6Zm0 2.5a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1H6Zm0 2.5a.5.5 0 0 0 0 1h8a.5.5 0 0 0 0-1H6Zm0 2.5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1H6Z" clipRule="evenodd" />
  </svg>
);

const IconList = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" clipRule="evenodd" />
  </svg>
);

const IconSparkles = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.632l2.051-.684a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.949 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
  </svg>
);

const IconTruck = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path d="M6.5 3A1.5 1.5 0 0 0 5 4.5H3a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h.5a2.5 2.5 0 0 0 5 0h3a2.5 2.5 0 0 0 5 0H17a2 2 0 0 0 2-2V9.485a2 2 0 0 0-.586-1.414l-1.899-1.9A2 2 0 0 0 15.101 5.6H14A1.5 1.5 0 0 0 12.5 4H8A1.5 1.5 0 0 0 6.5 3Zm7 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm6-6.5v2h2.101a.5.5 0 0 1 .354.146l1.899 1.9A.5.5 0 0 1 17 10.015V11h-1V9.485a1 1 0 0 0-.293-.707L13.808 6.88A1 1 0 0 0 13.101 6.6H13.5Z" />
  </svg>
);

const IconSliders = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24" aria-hidden>
    <path d="M17 2.75a.75.75 0 0 0-1.5 0v8.5H4.75a.75.75 0 0 0 0 1.5H15.5v3.5a.75.75 0 0 0 1.5 0V2.75ZM3 6.25a.75.75 0 0 0 1.5 0V2.75a.75.75 0 0 0-1.5 0V6.25Zm.75 2A2.25 2.25 0 0 0 1.5 10.5a2.25 2.25 0 0 0 2.25 2.25A2.25 2.25 0 0 0 6 10.5 2.25 2.25 0 0 0 3.75 8.25ZM3.75 9.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm12.5 3.75A2.25 2.25 0 0 0 14 15.75a2.25 2.25 0 0 0 2.25 2.25A2.25 2.25 0 0 0 18.5 15.75a2.25 2.25 0 0 0-2.25-2.25Zm0 1.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
  </svg>
);

const IconArrowRight = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden>
    <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
  </svg>
);

// Tile-surface icons, keyed by the adminNav SSOT keys. Note 카테고리 uses the list
// glyph here (distinct from the sidebar's tag glyph) — icons stay per-surface.
const ICONS: Partial<Record<AdminNavKey, React.ReactNode>> = {
  categories: <IconList />,
  products: <IconBox />,
  frames: <IconFrame />,
  options: <IconSliders />,
  orders: <IconList />,
  curation: <IconSparkles />,
  shipping: <IconTruck />,
};

function formatDate() {
  return new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

export default function AdminHomePage() {
  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-ink tracking-tight">
          안녕하세요, 관리자님
        </h2>
        <p className="text-sm text-mute">{formatDate()}</p>
      </div>

      {/* Quick Nav Grid */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone mb-3">
          빠른 이동
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {adminTileItems().map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className={cn(
                'group relative bg-canvas border border-hairline p-4 md:p-5',
                'flex flex-col gap-3',
                'transition-all duration-200',
                'hover:border-ink hover:shadow-sm',
                'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[3px]',
                'after:bg-ink after:scale-x-0 hover:after:scale-x-100',
                'after:transition-transform after:duration-200 after:origin-left',
              )}
            >
              <span className="text-ink">{ICONS[tile.key]}</span>
              <div className="flex-1">
                <p className="font-semibold text-ink text-sm">{tile.label}</p>
                <p className="text-xs text-mute mt-0.5 leading-relaxed">
                  {tile.tileDescription}
                </p>
              </div>
              <span className="self-end text-stone group-hover:text-ink transition-colors">
                <IconArrowRight />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
