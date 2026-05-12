import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Container } from '@/components/layout/Container';
import { ProductCard } from '@/components/ProductCard';
import { CampaignTile } from '@/components/marketing/CampaignTile';
import { CategoryIconCard } from '@/components/marketing/CategoryIconCard';
import { FaqRow } from '@/components/marketing/FaqRow';
import { MemberBenefitCard } from '@/components/marketing/MemberBenefitCard';
import { SectionHeader } from '@/components/marketing/SectionHeader';
import { getProductsByCategory } from '@/lib/db/catalog';
import { cn } from '@/lib/cn';
import type { ProductListItem } from '@/types';

export const metadata: Metadata = {
  title: 'FrameShop — 사진을 작품으로',
  description:
    '당신의 사진을 액자로. 미리보고 주문하는 모바일 액자 커머스.',
};

/**
 * Landing — Nike-style editorial commerce home.
 *
 *  Section rhythm (DESIGN-nike.md):
 *   1. Hero campaign tile (full-bleed)
 *   2. Featured Frames (3-up product grid, mobile 2-up)
 *   3. Shop by Size (4 icon cards, mobile horizontal scroll)
 *   4. Editorial campaign (single tile, drives editor entry)
 *   5. Member Benefits (3 dark-photographic cards)
 *   6. How It Works (4-step typographic row)
 *   7. FAQ (5-row accordion)
 *   8. Final CTA (black full-bleed slab)
 *
 *  Data: only the Featured Frames row depends on real DB rows.
 *  Everything else is hard-coded editorial content per PRD §1.1–1.2.
 *  Fetch failure or empty result is absorbed by Upcoming placeholders.
 */
export default async function LandingPage() {
  let featuredProducts: ProductListItem[] = [];

  try {
    const result = await getProductsByCategory('basic-frame', { pageSize: 3 });
    featuredProducts = result.items;
  } catch (err) {
    console.warn('Landing: getProductsByCategory("basic-frame") failed:', err);
  }

  // Pad to 3 slots — real products first, "Coming Soon" placeholders fill the rest.
  const featuredSlots: Array<
    { kind: 'product'; product: ProductListItem } | { kind: 'upcoming'; name: string; tagline: string }
  > = [
    ...featuredProducts.slice(0, 3).map(
      (p) => ({ kind: 'product' as const, product: p }),
    ),
  ];
  const upcomingFillers = [
    { name: '프리미엄 액자', tagline: '원목 프레임 / 매트 포함' },
    { name: '캔버스 액자', tagline: '대형 인테리어용' },
  ];
  while (featuredSlots.length < 3) {
    const idx = featuredSlots.filter((s) => s.kind === 'upcoming').length;
    const filler = upcomingFillers[idx] ?? upcomingFillers[0];
    featuredSlots.push({ kind: 'upcoming', name: filler.name, tagline: filler.tagline });
  }

  // Hero image: reuse the first featured product's thumbnail when available
  // so the landing never goes blank in production, but degrade to a pure
  // typography campaign when the seed hasn't been uploaded yet.
  const heroImage = featuredProducts[0]?.thumbnail ?? null;

  return (
    <>
      {/* ── 1. Hero campaign ───────────────────────────────────────────────── */}
      {heroImage ? (
        <CampaignTile
          imageUrl={heroImage}
          imageAlt="FrameShop 캠페인 — 사진을 작품으로"
          headline={
            <>
              TURN YOUR PHOTOS
              <br />
              INTO ART.
            </>
          }
          subhead="당신의 순간을, 액자에 담아 작품으로."
          cta={{ label: '지금 시작하기', href: '/catalog/basic-frame' }}
          aspect="16/9"
          headlineColor="light"
        />
      ) : (
        <HeroTypographyFallback
          headlineTop="TURN YOUR PHOTOS"
          headlineBottom="INTO ART."
          subhead="당신의 순간을, 액자에 담아 작품으로."
          cta={{ label: '지금 시작하기', href: '/catalog/basic-frame' }}
        />
      )}

      {/* ── 2. Featured Frames ─────────────────────────────────────────────── */}
      <Container size="xl" className="py-[48px] md:py-[72px]">
        <SectionHeader
          title="FEATURED FRAMES"
          eyebrow="추천 액자"
          linkLabel="모두 보기"
          linkHref="/catalog/basic-frame"
        />
        <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
          {featuredSlots.map((slot, i) => (
            <li key={i}>
              {slot.kind === 'product' ? (
                <ProductCard product={slot.product} />
              ) : (
                <UpcomingProductCard name={slot.name} tagline={slot.tagline} />
              )}
            </li>
          ))}
        </ul>
      </Container>

      {/* ── 3. Shop by Size ────────────────────────────────────────────────── */}
      <section className="bg-canvas py-[48px] md:py-[72px] border-t border-hairline-soft">
        <Container size="xl">
          <SectionHeader title="SHOP BY SIZE" eyebrow="사이즈로 찾기" />
          {/* Desktop: 4-up grid. Mobile: horizontal snap rail. */}
          <div className="hidden md:grid grid-cols-4 gap-6">
            {SIZE_CARDS.map((s) => (
              <CategoryIconCard
                key={s.code}
                icon={<SizeRatioIcon ratio={s.ratio} />}
                label={s.label}
                href={s.href}
              />
            ))}
          </div>
          <div
            className={cn(
              'md:hidden flex gap-4 overflow-x-auto snap-x snap-mandatory',
              '-mx-4 px-4 pb-2',
            )}
          >
            {SIZE_CARDS.map((s) => (
              <div
                key={s.code}
                className="snap-start shrink-0 w-[140px]"
              >
                <CategoryIconCard
                  icon={<SizeRatioIcon ratio={s.ratio} />}
                  label={s.label}
                  href={s.href}
                />
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── 4. Editorial campaign (studio entry) ───────────────────────────── */}
      <section className="py-[48px] md:py-[72px]">
        <Container size="xl">
          <HeroTypographyFallback
            headlineTop="EVERY PHOTO"
            headlineBottom="DESERVES A FRAME."
            subhead="1분 만에 미리보고 주문하세요."
            cta={{ label: '사진으로 시작하기', href: '/catalog/basic-frame' }}
            inset
          />
        </Container>
      </section>

      {/* ── 5. Member Benefits ─────────────────────────────────────────────── */}
      <section className="bg-canvas py-[48px] md:py-[72px] border-t border-hairline-soft">
        <Container size="xl">
          <SectionHeader title="MEMBER BENEFITS" eyebrow="회원 특별 혜택" />
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
            {MEMBER_BENEFITS.map((b) => (
              <li key={b.headline}>
                {b.imageUrl ? (
                  <MemberBenefitCard
                    imageUrl={b.imageUrl}
                    imageAlt={b.imageAlt ?? b.headline}
                    headline={b.headline}
                    eyebrow={b.eyebrow}
                    cta={b.cta}
                  />
                ) : (
                  <BenefitFallbackCard
                    headline={b.headline}
                    eyebrow={b.eyebrow}
                    body={b.body}
                    cta={b.cta}
                  />
                )}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ── 6. How It Works ────────────────────────────────────────────────── */}
      <section className="py-[48px] md:py-[72px] border-t border-hairline-soft">
        <Container size="xl">
          <SectionHeader title="HOW IT WORKS" eyebrow="3분이면 충분합니다" />
          <ol className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-3">
            {HOW_IT_WORKS.map((step, i) => (
              <li key={step.title}>
                <HowItWorksStep
                  index={i + 1}
                  title={step.title}
                  body={step.body}
                />
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* ── 7. FAQ ─────────────────────────────────────────────────────────── */}
      <section
        id="faq"
        className="bg-canvas py-[48px] md:py-[72px] border-t border-hairline-soft scroll-mt-24"
      >
        <Container size="md">
          <SectionHeader title="FAQ" eyebrow="자주 묻는 질문" />
          <div>
            {FAQ_ITEMS.map((q, i) => (
              <FaqRow
                key={q.question}
                question={q.question}
                defaultOpen={i === 0}
              >
                {q.answer}
              </FaqRow>
            ))}
          </div>
        </Container>
      </section>

      {/* ── 8. Final CTA ───────────────────────────────────────────────────── */}
      <FinalCallToAction />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline sub-components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upcoming product card — keeps the FEATURED FRAMES row from feeling empty
 * when the seed only ships one product. Mirrors `ProductCard` geometry so
 * the grid alignment stays mathematically tight.
 */
function UpcomingProductCard({ name, tagline }: { name: string; tagline: string }) {
  return (
    <div className="block rounded-none cursor-default" aria-disabled="true">
      <div className="relative aspect-square bg-soft-cloud overflow-hidden">
        <div className="absolute top-3 left-3">
          <span
            className={cn(
              'inline-flex items-center caption-sm uppercase tracking-wider',
              'bg-canvas text-ink border border-hairline',
              'rounded-[30px] px-3 py-1',
            )}
          >
            Coming Soon
          </span>
        </div>
        <div className="absolute inset-0 grid place-items-center">
          <span className="caption-md text-mute">곧 만나요</span>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <p className="body-strong text-ink truncate">{name}</p>
        <p className="caption-md text-mute truncate">{tagline}</p>
        <p className="body-strong text-mute">준비 중</p>
      </div>
    </div>
  );
}

/**
 * Hero typography fallback — pure-CSS campaign block used when no hero photo
 * is available (Phase 0 / Storage upload pending) AND for the secondary
 * editorial campaign that intentionally skips photography per DESIGN's
 * "typography can carry a campaign alone" allowance.
 */
function HeroTypographyFallback({
  headlineTop,
  headlineBottom,
  subhead,
  cta,
  inset = false,
}: {
  headlineTop: string;
  headlineBottom: string;
  subhead: string;
  cta: { label: string; href: string };
  /** When true, render as an inset block (inside a Container). */
  inset?: boolean;
}) {
  return (
    <section
      className={cn(
        'relative w-full overflow-hidden rounded-none bg-ink text-on-primary',
        'aspect-[4/5] md:aspect-[16/9]',
        // Subtle radial wash so the slab doesn't feel completely flat.
        '[background-image:radial-gradient(circle_at_30%_70%,#1f1f1f_0%,#111111_60%)]',
        inset ? '' : '',
      )}
    >
      <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-12">
        <h2 className="display-campaign max-w-[14ch]">
          {headlineTop}
          <br />
          {headlineBottom}
        </h2>
        <p className="mt-4 body-md max-w-[40ch]">{subhead}</p>
        <div className="mt-6">
          <Link
            href={cta.href}
            className={cn(
              'inline-flex items-center justify-center',
              'h-12 px-8 rounded-[30px] body-strong tap-collapse',
              'bg-canvas text-ink hover:bg-soft-cloud transition-colors',
            )}
          >
            {cta.label}
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Size ratio icon — a true-proportion outlined rectangle that reads at a
 * glance which aspect each catalog filter maps to. Drawn at 56×56 max bbox.
 */
function SizeRatioIcon({ ratio }: { ratio: [number, number] }) {
  const [w, h] = ratio;
  // Normalize so the longer side fits 48px while preserving proportion.
  const maxSide = 48;
  const longer = Math.max(w, h);
  const drawW = (w / longer) * maxSide;
  const drawH = (h / longer) * maxSide;
  const offsetX = (56 - drawW) / 2;
  const offsetY = (56 - drawH) / 2;
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x={offsetX}
        y={offsetY}
        width={drawW}
        height={drawH}
        fill="var(--color-canvas)"
        stroke="var(--color-ink)"
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * Photographic-feel benefit card without a photograph — degrades the
 * `MemberBenefitCard` to a pure-tone surface when no asset is available.
 * Keeps the 4:5 aspect ratio so the 3-up row stays even.
 */
function BenefitFallbackCard({
  headline,
  eyebrow,
  body,
  cta,
}: {
  headline: string;
  eyebrow?: string;
  body: string;
  cta: { label: string; href: string };
}) {
  return (
    <article
      className={cn(
        'relative w-full overflow-hidden rounded-none bg-ink text-on-primary',
        'aspect-[4/5]',
        '[background-image:radial-gradient(circle_at_70%_30%,#1f1f1f_0%,#111111_70%)]',
      )}
    >
      <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-8">
        {eyebrow ? (
          <p className="caption-sm uppercase text-stone mb-3 tracking-wider">
            {eyebrow}
          </p>
        ) : null}
        <h3 className="heading-lg text-on-primary max-w-[14ch]">{headline}</h3>
        <p className="mt-3 body-md text-stone max-w-[28ch]">{body}</p>
        <div className="mt-5">
          <Link
            href={cta.href}
            className={cn(
              'inline-flex items-center justify-center',
              'h-11 px-6 rounded-[30px] body-strong tap-collapse',
              'bg-canvas text-ink hover:bg-soft-cloud transition-colors',
            )}
          >
            {cta.label}
          </Link>
        </div>
      </div>
    </article>
  );
}

/**
 * How-it-works step — large display numeral over a short title + body line.
 * Pure typography per DESIGN's "no decorative gradient" principle.
 */
function HowItWorksStep({
  index,
  title,
  body,
}: {
  index: number;
  title: string;
  body: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-6 md:pt-8">
      <span
        className="display-campaign text-ink"
        style={{ fontSize: 'clamp(48px, 6vw, 72px)' }}
      >
        {String(index).padStart(2, '0')}
      </span>
      <p className="heading-md text-ink">{title}</p>
      <p className="caption-md text-mute">{body}</p>
    </div>
  );
}

/**
 * Final call-to-action — pure black slab, single primary action.
 * Mirrors Nike's `/membership` page closer with a centered campaign lockup.
 */
function FinalCallToAction() {
  return (
    <section className="relative w-full bg-ink text-on-primary">
      <div className="mx-auto max-w-[1280px] px-4 md:px-6 py-[64px] md:py-[120px] flex flex-col items-center text-center">
        <h2 className="display-campaign max-w-[14ch]">START NOW.</h2>
        <p className="mt-4 body-md text-stone max-w-[40ch]">
          당신의 사진, 작품으로.
        </p>
        <div className="mt-8">
          <Link
            href="/catalog/basic-frame"
            className={cn(
              'inline-flex items-center justify-center',
              'h-12 px-8 rounded-[30px] body-strong tap-collapse',
              'bg-canvas text-ink hover:bg-soft-cloud transition-colors',
            )}
          >
            지금 시작하기
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Static content
// ─────────────────────────────────────────────────────────────────────────────

const SIZE_CARDS: Array<{
  code: string;
  label: string;
  href: string;
  ratio: [number, number];
}> = [
  { code: '4x6', label: '4×6 (10×15cm)', href: '/catalog/basic-frame?size=4x6', ratio: [4, 6] },
  { code: '5x7', label: '5×7 (13×18cm)', href: '/catalog/basic-frame?size=5x7', ratio: [5, 7] },
  { code: '8x10', label: '8×10 (20×25cm)', href: '/catalog/basic-frame?size=8x10', ratio: [8, 10] },
  { code: '11x14', label: '11×14 (28×36cm)', href: '/catalog/basic-frame?size=11x14', ratio: [11, 14] },
];

type MemberBenefit = {
  headline: string;
  eyebrow: string;
  body: string;
  cta: { label: string; href: string };
  // imageUrl/imageAlt optional — when absent, fallback card renders.
  imageUrl?: string;
  imageAlt?: string;
};

const MEMBER_BENEFITS: MemberBenefit[] = [
  {
    headline: 'FREE SHIPPING',
    eyebrow: '무료 배송',
    body: '30,000원 이상 구매 시 전국 무료 배송.',
    cta: { label: '회원가입', href: '/login' },
  },
  {
    headline: 'FAST CRAFT',
    eyebrow: '빠른 제작',
    body: '주문 후 영업일 3일 내 제작 완료.',
    cta: { label: '제작 과정 보기', href: '/catalog/basic-frame' },
  },
  {
    headline: 'PERFECT PROOF',
    eyebrow: '미리보기 보장',
    body: '100% 시각 미리보기로 받기 전 결과 확인.',
    cta: { label: '지금 미리보기', href: '/catalog/basic-frame' },
  },
];

const HOW_IT_WORKS = [
  { title: '사진 선택', body: '갤러리에서 한 장만 골라주세요.' },
  { title: '액자 결정', body: '사이즈 · 색상 · 매트를 한 번에.' },
  { title: '미리보기', body: '실시간 합성으로 결과를 확인.' },
  { title: '주문', body: '결제 후 영업일 3일이면 도착.' },
];

const FAQ_ITEMS: Array<{ question: string; answer: string }> = [
  {
    question: '어떤 사진을 사용할 수 있나요?',
    answer:
      'JPG, PNG, HEIC 형식이 가능합니다. 권장 해상도는 1600px 이상이며, 업로드 시 자동으로 최적화됩니다.',
  },
  {
    question: '인쇄 품질은 어떤가요?',
    answer:
      '300dpi 고해상도 인쇄 + 색공간 ICC 프로파일을 적용합니다. 디스플레이와 미세한 색 차이가 있을 수 있습니다.',
  },
  {
    question: '배송은 얼마나 걸리나요?',
    answer:
      '주문 후 영업일 기준 제작 3일 + 배송 1–2일이 소요됩니다. 직접 수령(픽업)도 가능합니다.',
  },
  {
    question: '교환/환불 가능한가요?',
    answer:
      '주문 제작 특성상 단순 변심 환불은 불가하지만, 인쇄/배송 불량은 100% 교환해드립니다.',
  },
  {
    question: '큰 사이즈도 가능한가요?',
    answer:
      '현재 11×14(28×36cm)까지 제공되며, Phase 2에서 16×20, 24×36 등 대형 사이즈를 출시 예정입니다.',
  },
];
