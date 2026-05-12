import Link from 'next/link';
import { Container } from './Container';

/**
 * Site footer — Nike-aligned.
 *
 *  Surface (DESIGN-nike.md `footer`):
 *   - bg-canvas with a 1px hairline top divider
 *   - 4-column link list: Resources / Help / Company / About
 *   - column headers `body-strong` ink; link rows `caption-md` mute
 *   - below the columns: a horizontal rule, then a fine-print row in
 *     `utility-xs` (9px) — copyright, terms, privacy
 */

const COLUMNS: Array<{
  heading: string;
  links: Array<{ label: string; href: string }>;
}> = [
  {
    heading: '카탈로그',
    links: [
      { label: '베이직 액자', href: '/catalog/basic-frame' },
      { label: '프리미엄 액자', href: '/catalog/premium-frame' },
      { label: '포토 프린트', href: '/catalog/photo-print' },
    ],
  },
  {
    heading: '고객지원',
    links: [
      { label: '주문조회', href: '/order/lookup' },
      { label: '배송 안내', href: '/help/shipping' },
      { label: '교환·환불', href: '/help/returns' },
      { label: '자주 묻는 질문', href: '/help/faq' },
    ],
  },
  {
    heading: '회사',
    links: [
      { label: '회사 소개', href: '/about' },
      { label: '이용약관', href: '/legal/terms' },
      { label: '개인정보처리방침', href: '/legal/privacy' },
    ],
  },
  {
    heading: '문의',
    links: [
      { label: '평일 10:00 – 18:00', href: '/help/contact' },
      { label: '카카오 채널', href: '/help/contact' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-auto bg-canvas border-t border-hairline">
      <Container size="xl" className="py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {COLUMNS.map((col) => (
            <div key={col.heading} className="flex flex-col gap-3">
              <p className="body-strong text-ink">{col.heading}</p>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="caption-md text-mute hover:text-ink transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <hr className="my-8 border-t border-hairline" />
        <div className="flex flex-col md:flex-row gap-2 md:justify-between utility-xs text-mute">
          <p>© {new Date().getFullYear()} FrameShop. All rights reserved.</p>
          <p>
            <Link href="/legal/terms" className="hover:text-ink">
              이용약관
            </Link>
            <span className="mx-2">·</span>
            <Link href="/legal/privacy" className="hover:text-ink">
              개인정보처리방침
            </Link>
          </p>
        </div>
      </Container>
    </footer>
  );
}
