/**
 * P1-07: Returns the Supabase Storage public URL for an Unsplash photo
 * that has been mirrored to the `marketing` bucket via scripts/mirror-unsplash.mjs.
 * All landing-page images now resolve from our own CDN — no Unsplash hot-link risk.
 */
export function mirrored(id: string): string {
  return `https://acxsxjmqgvkceqahwkpz.supabase.co/storage/v1/object/public/marketing/unsplash/${id}.jpg`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero showcase — the first thing the visitor sees
// ─────────────────────────────────────────────────────────────────────────────

export type HeroSlide = {
  imageUrl: string;
  imageAlt: string;
  /** Render context — small thumbnail above the active slide. */
  thumbnailUrl: string;
  /** Eyebrow shown above the headline (Bebas Neue uppercase). */
  eyebrow: string;
  headlineTop: string;
  headlineBottom: string;
  subhead: string;
  cta: { label: string; href: string };
  /** Headline burn-in tone — chosen per-photograph. */
  tone: 'light' | 'dark';
};

export const HERO_SLIDES: HeroSlide[] = [
  {
    imageUrl: mirrored('1513519245088-0e12902e5a38'),
    thumbnailUrl: mirrored('1513519245088-0e12902e5a38'),
    imageAlt: '거실 벽에 걸린 액자 갤러리 — 따뜻한 햇살 아래의 가족 사진',
    eyebrow: 'NEW SEASON 2026',
    headlineTop: 'YOUR MEMORIES,',
    headlineBottom: 'FRAMED FOREVER.',
    subhead: '가족, 풍경, 그리고 명화. 거실의 빈 벽을 작품으로 채우세요.',
    cta: { label: '지금 시작하기', href: '/catalog/basic-frame' },
    tone: 'light',
  },
  {
    imageUrl: mirrored('1607082348824-0a96f2a4b9da'),
    thumbnailUrl: mirrored('1607082348824-0a96f2a4b9da'),
    imageAlt: '미술관 갤러리 벽면에 정렬된 명화 액자',
    eyebrow: 'MASTERPIECE EDITION',
    headlineTop: 'GALLERY AT',
    headlineBottom: 'HOME.',
    subhead: '클로드 모네부터 한국 근대 회화까지 — 명작을 우리 집 거실에.',
    cta: { label: '명화 컬렉션 보기', href: '/catalog/basic-frame?theme=masterpiece' },
    tone: 'light',
  },
  {
    imageUrl: mirrored('1506905925346-21bda4d32df4'),
    thumbnailUrl: mirrored('1506905925346-21bda4d32df4'),
    imageAlt: '안개에 잠긴 산맥 풍경 — 새벽의 알펜글로',
    eyebrow: 'LANDSCAPE PRINTS',
    headlineTop: 'NATURE,',
    headlineBottom: 'IMMORTALIZED.',
    subhead: '300dpi 미세 인쇄로 담는 풍경의 디테일.',
    cta: { label: '풍경 컬렉션 보기', href: '/catalog/basic-frame?theme=landscape' },
    tone: 'light',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Masterpiece gallery — 6-up grid of iconic art, framed in our products
// ─────────────────────────────────────────────────────────────────────────────

export type MasterpieceTile = {
  imageUrl: string;
  imageAlt: string;
  title: string;
  artist: string;
  size: string;
  frameLabel: string;
  /** Optional swatch color rendered as a 14 px dot on the card. */
  swatch?: string;
  href: string;
};

/**
 * NOTE: These are photographs of framed prints in interior settings,
 * not the masterpieces themselves. Using interior staging keeps the
 * page commercial (people see the product, not the artwork's brand).
 */
export const MASTERPIECE_TILES: MasterpieceTile[] = [
  {
    imageUrl: mirrored('1582738411706-bfc8e691d1c2'),
    imageAlt: '인테리어에 걸린 인상주의 명화 액자',
    title: 'Water Lilies, 1916',
    artist: 'Claude Monet',
    size: '8×10 / 20×25cm',
    frameLabel: '블랙 우드',
    swatch: '#1a1a1a',
    href: '/catalog/basic-frame?size=8x10',
  },
  {
    imageUrl: mirrored('1554188248-986adbb73be4'),
    imageAlt: '갤러리 화이트 월에 걸린 추상화',
    title: 'Composition VIII',
    artist: 'Wassily Kandinsky',
    size: '11×14 / 28×36cm',
    frameLabel: '화이트 매트',
    swatch: '#f4f4f4',
    href: '/catalog/basic-frame?size=11x14',
  },
  {
    imageUrl: mirrored('1452860606245-08befc0ff44b'),
    imageAlt: '우드 프레임에 담긴 풍경 사진',
    title: 'Starry Night Sky',
    artist: 'Vincent van Gogh',
    size: '5×7 / 13×18cm',
    frameLabel: '오크 우드',
    swatch: '#c9a87c',
    href: '/catalog/basic-frame?size=5x7',
  },
  {
    imageUrl: mirrored('1577720580479-7d839d829c73'),
    imageAlt: '벽에 정렬된 흑백 사진 액자',
    title: 'Girl with a Pearl Earring',
    artist: 'Johannes Vermeer',
    size: '8×10 / 20×25cm',
    frameLabel: '브론즈',
    swatch: '#5b3a1f',
    href: '/catalog/basic-frame?size=8x10',
  },
  {
    imageUrl: mirrored('1545987796-200677ee1011'),
    imageAlt: '인테리어에 걸린 풍경 사진 액자',
    title: 'The Great Wave',
    artist: 'Katsushika Hokusai',
    size: '11×14 / 28×36cm',
    frameLabel: '블랙 매트',
    swatch: '#0d0d0d',
    href: '/catalog/basic-frame?size=11x14',
  },
  {
    imageUrl: mirrored('1518998053901-5348d3961a04'),
    imageAlt: '가구 위에 진열된 액자',
    title: 'The Birth of Venus',
    artist: 'Sandro Botticelli',
    size: '4×6 / 10×15cm',
    frameLabel: '내추럴 우드',
    swatch: '#d4b48a',
    href: '/catalog/basic-frame?size=4x6',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Landscape collection — horizontal rail of large nature prints
// ─────────────────────────────────────────────────────────────────────────────

export type LandscapeTile = {
  imageUrl: string;
  imageAlt: string;
  title: string;
  caption: string;
  href: string;
};

export const LANDSCAPE_TILES: LandscapeTile[] = [
  {
    imageUrl: mirrored('1506905925346-21bda4d32df4'),
    imageAlt: '새벽 안개에 잠긴 산맥',
    title: 'ALPINE GLOW',
    caption: '새벽의 산맥, 알펜글로 시리즈',
    href: '/catalog/basic-frame?theme=landscape',
  },
  {
    imageUrl: mirrored('1470071459604-3b5ec3a7fe05'),
    imageAlt: '안개 낀 숲',
    title: 'FOREST CALM',
    caption: '북유럽 침엽수림의 정적',
    href: '/catalog/basic-frame?theme=landscape',
  },
  {
    imageUrl: mirrored('1501785888041-af3ef285b470'),
    imageAlt: '해안 절벽과 바다',
    title: 'OCEAN BREATH',
    caption: '제주 바다, 한 호흡의 풍경',
    href: '/catalog/basic-frame?theme=landscape',
  },
  {
    imageUrl: mirrored('1469474968028-56623f02e42e'),
    imageAlt: '강과 산',
    title: 'RIVER LINES',
    caption: '비가 갠 후의 강 풍경',
    href: '/catalog/basic-frame?theme=landscape',
  },
  {
    imageUrl: mirrored('1418065460487-3e41a6c84dc5'),
    imageAlt: '들판 위 일몰',
    title: 'GOLDEN HOUR',
    caption: '황금 시간대의 들판',
    href: '/catalog/basic-frame?theme=landscape',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Lifestyle studio — split tile (image + editorial copy)
// ─────────────────────────────────────────────────────────────────────────────

export type LifestyleBlock = {
  imageUrl: string;
  imageAlt: string;
  eyebrow: string;
  headline: string;
  body: string;
  bullets: string[];
  cta: { label: string; href: string };
};

export const LIFESTYLE_BLOCKS: LifestyleBlock[] = [
  {
    imageUrl: mirrored('1597423498219-04418210827d'),
    imageAlt: '거실에 정돈된 갤러리 월 — 다양한 사이즈의 액자 6점',
    eyebrow: 'GALLERY WALL',
    headline: '한 벽으로 완성되는\n나만의 갤러리',
    body: '4×6부터 11×14까지, 사이즈를 섞어 배치할 수 있도록 매트 두께를 통일했습니다. 거실의 가장 큰 벽에 어울리는 큐레이션을 제안해 드립니다.',
    bullets: [
      '6점 한 세트 — 사이즈 자동 매칭',
      '매트 두께 5 / 10 / 15 mm 통일',
      '벽걸이용 D-ring + 수평계 동봉',
    ],
    cta: { label: '갤러리 월 시작하기', href: '/catalog/basic-frame' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Member benefits — replaces the dark text fallbacks with real photography
// ─────────────────────────────────────────────────────────────────────────────

export const MEMBER_BENEFIT_TILES = [
  {
    imageUrl: mirrored('1607082348824-0a96f2a4b9da'),
    imageAlt: '택배 박스를 받는 따뜻한 손 — 무료 배송 컨셉',
    eyebrow: '무료 배송',
    headline: 'FREE SHIPPING',
    cta: { label: '회원가입', href: '/login' },
  },
  {
    imageUrl: mirrored('1452860606245-08befc0ff44b'),
    imageAlt: '작업실에서 액자를 제작하는 모습',
    eyebrow: '빠른 제작',
    headline: '3-DAY CRAFT',
    cta: { label: '제작 과정', href: '/catalog/basic-frame' },
  },
  {
    imageUrl: mirrored('1556015048-4d3aa10df74c'),
    imageAlt: '편집기 미리보기 — 사용자가 사진을 액자에 맞춰보는 장면',
    eyebrow: '미리보기 보장',
    headline: 'PERFECT PROOF',
    cta: { label: '지금 미리보기', href: '/catalog/basic-frame' },
  },
] as const;
