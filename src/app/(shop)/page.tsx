import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { buildFaqJsonLd, SITE_URL, DEFAULT_OG_IMAGE } from '@/lib/seo/metadata';
import { getTranslations } from 'next-intl/server';

import { Container } from '@/components/layout/Container';
import { ProductCard } from '@/components/ProductCard';
import { CategoryIconCard } from '@/components/marketing/CategoryIconCard';
import { CollectionRail } from '@/components/marketing/CollectionRail';
import { FaqRow } from '@/components/marketing/FaqRow';
import { HeroShowcase } from '@/components/marketing/HeroShowcase';
import { LifestyleStudio } from '@/components/marketing/LifestyleStudio';
import { MasterpieceGallery } from '@/components/marketing/MasterpieceGallery';
import { RecentReviews } from '@/components/marketing/RecentReviews';
import { SectionHeader } from '@/components/marketing/SectionHeader';
import {
  HERO_SLIDES,
  LANDSCAPE_TILES,
  LIFESTYLE_BLOCKS,
  MASTERPIECE_TILES,
  MEMBER_BENEFIT_TILES,
  mirrored,
} from '@/data/landing-curation';
import type { HeroSlide, LandscapeTile } from '@/data/landing-curation';

/**
 * Fallback thumbnails for featured products that have no product_images record.
 * These are framed-print interior photography already mirrored to our CDN.
 */
const FEATURED_FALLBACK_THUMBS = [
  mirrored('1513519245088-0e12902e5a38'), // 거실 갤러리 월 — 따뜻한 인테리어
  mirrored('1582738411706-bfc8e691d1c2'), // 명화 액자 인테리어
  mirrored('1452860606245-08befc0ff44b'), // 우드 프레임 풍경
] as const;
import { getProductsByCategory } from '@/lib/db/catalog';
import { getActiveCurations, getCurationProducts } from '@/lib/db/curation';
import { cn } from '@/lib/cn';
import type { ProductListItem } from '@/types';
import type { BannerPayload, CollectionPayload, FeaturePayload, Curation } from '@/types/curation';

export const metadata: Metadata = {
  title: '사진을 작품으로 — 맞춤 액자 주문',
  description:
    '풍경, 가족, 명화. 당신의 한 장을 액자에 담아 거실의 작품으로. 300dpi 미세 인쇄 + 3일 제작.',
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: 'FrameShop — 사진을 작품으로',
    description: '풍경, 가족, 명화. 당신의 한 장을 액자에 담아 거실의 작품으로.',
    type: 'website',
    locale: 'ko_KR',
    url: SITE_URL,
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: 'FrameShop' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FrameShop — 사진을 작품으로',
    description: '풍경, 가족, 명화. 당신의 한 장을 액자에 담아 거실의 작품으로.',
    images: [DEFAULT_OG_IMAGE],
  },
};

/**
 * Landing page — gallery-grade editorial home (2026-05-13 redesign).
 *
 *  Cached as ISR with a 10-minute revalidate window. The only DB-dependent
 *  row is the FEATURED FRAMES grid; everything else is hard-coded
 *  editorial photography from `data/landing-curation.ts`. A cached HTML
 *  payload + the Next 16 Router Cache (staleTimes.dynamic = 30 s) is what
 *  takes the prior "3-second menu hop" down into the high-millisecond
 *  range on warm sessions.
 *
 *  Section rhythm:
 *    1. HeroShowcase           — 3-slide cinematic carousel (Bebas Neue)
 *    2. FEATURED FRAMES        — real DB products
 *    3. MASTERPIECE GALLERY    — 6 framed art editions
 *    4. SHOP BY SIZE           — 4 icon cards
 *    5. LIFESTYLE STUDIO       — split editorial spread
 *    6. LANDSCAPE COLLECTION   — horizontal rail of nature prints
 *    7. MEMBER BENEFITS        — 3 photographic cards (real photos)
 *    8. HOW IT WORKS           — 4-step typographic row
 *    9. FAQ                    — accordion
 *   10. FINAL CTA              — black slab
 */
export const revalidate = 60; // 1분 ISR (Task 3: DB 연동으로 단축)

// ── DB 큐레이션 어댑터 ──────────────────────────────────────────────────────────

/** BannerPayload → HeroSlide 변환 */
function bannerToHeroSlide(c: Curation): HeroSlide | null {
  const p = c.payload as BannerPayload | null;
  if (!p?.imageUrl) return null;
  return {
    imageUrl: p.imageUrl,
    thumbnailUrl: p.imageUrl,
    imageAlt: p.title ?? c.title ?? '배너 이미지',
    eyebrow: 'NEW',
    headlineTop: p.title ?? '',
    headlineBottom: '',
    subhead: p.subtitle ?? '',
    cta: p.link
      ? { label: '자세히 보기', href: p.link }
      : { label: '지금 시작하기', href: '/catalog/basic-frame' },
    tone: 'light',
  };
}

/** CollectionPayload 상품 → LandscapeTile 변환 */
function productToLandscapeTile(product: ProductListItem): LandscapeTile {
  return {
    imageUrl: product.thumbnail ?? '',
    imageAlt: product.name,
    title: product.name.toUpperCase(),
    caption: product.tagline,
    href: `/product/${product.id as string}`,
  };
}

export default async function LandingPage() {
  const t = await getTranslations('landing');
  // ── DB 큐레이션 로드 (fallback: static 데이터) ──────────────────────────────
  let dbHeroSlides: HeroSlide[] = [];
  let dbCollectionTiles: LandscapeTile[] = [];
  let dbCollectionSubtitle: string | undefined;

  try {
    const curations = await getActiveCurations('all');

    // banner → HeroShowcase
    const bannerCurations = curations.filter((c) => c.type === 'banner');
    if (bannerCurations.length > 0) {
      const slides = bannerCurations.flatMap((c) => {
        const slide = bannerToHeroSlide(c);
        return slide ? [slide] : [];
      });
      if (slides.length > 0) dbHeroSlides = slides;
    }

    // collection → CollectionRail (첫 번째 collection 큐레이션만 사용)
    const collectionCuration = curations.find((c) => c.type === 'collection');
    if (collectionCuration) {
      const p = collectionCuration.payload as CollectionPayload | null;
      if (p?.productIds && p.productIds.length > 0) {
        const products = await getCurationProducts(p.productIds as string[]);
        dbCollectionTiles = products.map(productToLandscapeTile);
        dbCollectionSubtitle = p.subtitle;
      }
    }
  } catch (err) {
    console.warn('Landing: 큐레이션 로드 실패, static 데이터로 fallback:', err);
  }

  const heroSlides = dbHeroSlides.length > 0 ? dbHeroSlides : HERO_SLIDES;
  const collectionTiles = dbCollectionTiles.length > 0 ? dbCollectionTiles : LANDSCAPE_TILES;

  let featuredProducts: ProductListItem[] = [];
  try {
    const result = await getProductsByCategory('basic-frame', { pageSize: 3 });
    // Inject fallback thumbnails for products with no product_images yet.
    featuredProducts = result.items.map((p, i) => ({
      ...p,
      thumbnail: p.thumbnail ?? FEATURED_FALLBACK_THUMBS[i % FEATURED_FALLBACK_THUMBS.length] ?? null,
    }));
  } catch (err) {
    console.warn('Landing: getProductsByCategory("basic-frame") failed:', err);
  }

  // Pad the FEATURED FRAMES row to 3 cells using "Coming Soon" placeholders.
  const featuredSlots: Array<
    | { kind: 'product'; product: ProductListItem }
    | { kind: 'upcoming'; name: string; tagline: string }
  > = [
    ...featuredProducts.slice(0, 3).map(
      (p) => ({ kind: 'product' as const, product: p }),
    ),
  ];
  const upcomingFillers = [
    { name: '프리미엄 우드 액자', tagline: '오크 · 월넛 · 메이플' },
    { name: '캔버스 액자', tagline: '대형 인테리어 (16×20 이상)' },
  ];
  while (featuredSlots.length < 3) {
    const idx = featuredSlots.filter((s) => s.kind === 'upcoming').length;
    const filler = upcomingFillers[idx] ?? upcomingFillers[0];
    featuredSlots.push({ kind: 'upcoming', name: filler.name, tagline: filler.tagline });
  }

  const faqJsonLd = buildFaqJsonLd([
    {
      question: '배송은 얼마나 걸리나요?',
      answer: '결제 완료 후 영업일 기준 1~3일 이내 발송됩니다.',
    },
    {
      question: '어떤 액자 사이즈를 지원하나요?',
      answer: '4x6, 5x7, 8x10, 11x14 인치를 지원합니다.',
    },
    {
      question: '어떤 결제 수단을 지원하나요?',
      answer:
        'Toss Payments를 통해 신용카드, 계좌이체, 카카오페이, 네이버페이 등을 지원합니다.',
    },
    {
      question: '환불이 가능한가요?',
      answer:
        '제작 시작 전까지 전액 환불 가능합니다. 제작 시작 후에는 환불이 어렵습니다.',
    },
    {
      question: '어떤 사진 형식을 업로드할 수 있나요?',
      answer:
        'JPG, PNG 형식을 지원합니다. 고화질 인쇄를 위해 최소 1500px 이상 권장합니다.',
    },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {/* ── 1. Hero showcase ───────────────────────────────────────────── */}
      <HeroShowcase slides={heroSlides} />

      {/* ── 2. Featured Frames (DB-backed) ─────────────────────────────── */}
      <Container size="xl" className="py-[48px] md:py-[80px]">
        <SectionHeader
          title={t('featuredFrames')}
          eyebrow={t('featuredFramesEyebrow')}
          linkLabel={t('viewAll')}
          linkHref="/catalog/basic-frame"
        />
        <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
          {featuredSlots.map((slot, i) => (
            <li key={i}>
              {slot.kind === 'product' ? (
                <ProductCard
                  product={slot.product}
                  badge={i === 0 ? 'BEST' : undefined}
                  lazyImage={i > 0}
                />
              ) : (
                <UpcomingProductCard
                  name={slot.name}
                  tagline={slot.tagline}
                  badgeLabel={t('upcomingBadge')}
                  comingSoonLabel={t('comingSoon')}
                  preparingLabel={t('preparingLabel')}
                />
              )}
            </li>
          ))}
        </ul>
      </Container>

      {/* ── 3. Masterpiece Gallery ─────────────────────────────────────── */}
      <section className="bg-canvas py-[48px] md:py-[80px] border-t border-hairline-soft">
        <Container size="xl">
          <SectionHeader
            title={t('masterpieceGallery')}
            eyebrow={t('masterpieceEyebrow')}
            linkLabel={t('viewMasterpieces')}
            linkHref="/catalog/basic-frame?theme=masterpiece"
          />
          <MasterpieceGallery tiles={MASTERPIECE_TILES} />
        </Container>
      </section>

      {/* ── 3-B. Recent Reviews ────────────────────────────────────────── */}
      <RecentReviews />

      {/* ── 4. Shop by Size ────────────────────────────────────────────── */}
      <section className="bg-soft-cloud py-[48px] md:py-[80px]">
        <Container size="xl">
          <SectionHeader title={t('shopBySize')} eyebrow={t('shopBySizeEyebrow')} />
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
              <div key={s.code} className="snap-start shrink-0 w-[140px]">
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

      {/* ── 5. Lifestyle Studio ────────────────────────────────────────── */}
      <section className="py-[48px] md:py-[96px]">
        <Container size="xl">
          {LIFESTYLE_BLOCKS.map((block, i) => (
            <LifestyleStudio
              key={block.headline}
              block={block}
              imageOn={i % 2 === 0 ? 'right' : 'left'}
            />
          ))}
        </Container>
      </section>

      {/* ── 6. Landscape Collection ────────────────────────────────────── */}
      <section className="bg-canvas py-[48px] md:py-[80px] border-t border-hairline-soft">
        <Container size="xl">
          <SectionHeader
            title={t('landscapePrints')}
            eyebrow={t('landscapeEyebrow')}
            linkLabel={t('viewLandscape')}
            linkHref="/catalog/basic-frame?theme=landscape"
          />
          {dbCollectionSubtitle && (
            <p className="text-sm text-muted-fg mb-4">{dbCollectionSubtitle}</p>
          )}
          <CollectionRail tiles={collectionTiles} />
        </Container>
      </section>

      {/* ── 7. Member Benefits ─────────────────────────────────────────── */}
      <section className="bg-canvas py-[48px] md:py-[80px] border-t border-hairline-soft">
        <Container size="xl">
          <SectionHeader title={t('memberBenefits')} eyebrow={t('memberBenefitsEyebrow')} />
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
            {MEMBER_BENEFIT_TILES.map((b) => (
              <li key={b.headline}>
                <article className="relative w-full aspect-[4/5] overflow-hidden rounded-none bg-ink">
                  <Image
                    src={b.imageUrl}
                    alt={b.imageAlt}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover opacity-90"
                    loading="lazy"
                  />
                  <div aria-hidden className="absolute inset-0 scrim-bottom" />
                  <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-8 text-on-primary">
                    <p className="caption-sm uppercase text-stone mb-3 tracking-wider">
                      {b.eyebrow}
                    </p>
                    <h3 className="heading-lg max-w-[14ch]">{b.headline}</h3>
                    <div className="mt-5">
                      <Link
                        href={b.cta.href}
                        className={cn(
                          'inline-flex items-center justify-center',
                          'h-11 px-6 rounded-[30px] body-strong tap-collapse',
                          'bg-canvas text-ink hover:bg-soft-cloud transition-colors',
                        )}
                      >
                        {b.cta.label}
                      </Link>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ── 8. How It Works ────────────────────────────────────────────── */}
      <section
        id="how-it-works"
        className="py-[48px] md:py-[80px] border-t border-hairline-soft scroll-mt-24"
      >
        <Container size="xl">
          <SectionHeader title={t('howItWorksTitle')} eyebrow={t('howItWorksEyebrow')} />
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

      {/* ── 9. FAQ ─────────────────────────────────────────────────────── */}
      <section
        id="faq"
        className="bg-soft-cloud py-[48px] md:py-[80px] scroll-mt-24"
      >
        <Container size="md">
          <SectionHeader title={t('faqTitle')} eyebrow={t('faqEyebrow')} />
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

      {/* ── 10. Final CTA ──────────────────────────────────────────────── */}
      <FinalCallToAction
        eyebrow={t('finalCtaEyebrow')}
        headline={t('finalCtaHeadline')}
        body={t('finalCtaBody')}
        startLabel={t('finalCtaStart')}
        howLabel={t('finalCtaHow')}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline sub-components
// ─────────────────────────────────────────────────────────────────────────────

function UpcomingProductCard({
  name,
  tagline,
  badgeLabel,
  comingSoonLabel,
  preparingLabel,
}: {
  name: string;
  tagline: string;
  badgeLabel: string;
  comingSoonLabel: string;
  preparingLabel: string;
}) {
  return (
    <div className="block rounded-none cursor-default" aria-disabled="true">
      <div className="relative aspect-square bg-soft-cloud overflow-hidden">
        <div className="absolute top-3 left-3 z-10">
          <span
            className={cn(
              'inline-flex items-center caption-sm uppercase tracking-wider',
              'bg-canvas text-ink border border-hairline',
              'rounded-[30px] px-3 py-1',
            )}
          >
            {badgeLabel}
          </span>
        </div>
        <div
          className="absolute inset-0 grid place-items-center"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent 0 11px, rgba(0,0,0,0.04) 11px 12px)',
          }}
        >
          <span className="caption-md text-mute">{comingSoonLabel}</span>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <p className="body-strong text-ink truncate">{name}</p>
        <p className="caption-md text-mute truncate">{tagline}</p>
        <p className="body-strong text-mute">{preparingLabel}</p>
      </div>
    </div>
  );
}

function SizeRatioIcon({ ratio }: { ratio: [number, number] }) {
  const [w, h] = ratio;
  const maxSide = 48;
  const longer = Math.max(w, h);
  const drawW = (w / longer) * maxSide;
  const drawH = (h / longer) * maxSide;
  const offsetX = (56 - drawW) / 2;
  const offsetY = (56 - drawH) / 2;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
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

function FinalCallToAction({
  eyebrow,
  headline,
  body,
  startLabel,
  howLabel,
}: {
  eyebrow: string;
  headline: string;
  body: string;
  startLabel: string;
  howLabel: string;
}) {
  return (
    <section className="relative w-full bg-ink text-on-primary overflow-hidden">
      {/* Soft radial glow so the slab doesn't read as a flat rectangle. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0) 60%)',
        }}
      />
      <div className="relative mx-auto max-w-[1280px] px-4 md:px-6 py-[72px] md:py-[140px] flex flex-col items-center text-center">
        <p className="eyebrow text-canvas mb-4">{eyebrow}</p>
        <h2 className="display-campaign max-w-[14ch]">{headline}</h2>
        <p className="mt-4 body-md text-stone max-w-[42ch]">
          {body}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/catalog/basic-frame"
            className={cn(
              'inline-flex items-center justify-center',
              'h-12 px-8 rounded-[30px] body-strong tap-collapse',
              'bg-canvas text-ink hover:bg-soft-cloud transition-colors',
            )}
          >
            {startLabel}
          </Link>
          <Link
            href="/#how-it-works"
            className={cn(
              'inline-flex items-center justify-center',
              'h-12 px-6 rounded-[30px] body-strong tap-collapse',
              'border border-canvas/60 text-canvas hover:bg-canvas/10 transition-colors',
            )}
          >
            {howLabel}
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
