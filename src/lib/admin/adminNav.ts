/**
 * 어드민 내비게이션 단일 출처(SSOT).
 *
 * 데스크톱 사이드바(AdminSidebar), 모바일 하단바(AdminMobileBottomNav), 어드민 홈
 * 빠른이동 타일(admin/page.tsx) 세 곳이 각각 하드코딩하던 라우트 목록(href/label/
 * 그룹/설명)을 여기로 모은다. 아이콘은 표면마다 글리프/크기가 달라(예: 타일의
 * 카테고리는 목록 아이콘, 사이드바는 태그 아이콘) 각 컴포넌트가 `AdminNavKey` 로
 * 키잉한 로컬 아이콘 맵을 유지한다 — 중복이던 "어떤 페이지가 어디에 어떤 라벨로
 * 노출되는가"만 일원화한다(ADR-023 P0, 스펙 §5 adminNav SSOT).
 *
 * 순수 데이터(JSX 없음) — 서버/클라이언트 양쪽에서 import 가능.
 */

export type AdminNavKey =
  | 'dashboard'
  | 'categories'
  | 'products'
  | 'frames'
  | 'options'
  | 'orders'
  | 'reviews'
  | 'inquiries'
  | 'coupons'
  | 'curation'
  | 'artworks'
  | 'landing'
  | 'shipping'
  | 'settings';

export type AdminNavSectionId = 'main' | 'catalog' | 'ops' | 'settings';

export type AdminNavItem = {
  key: AdminNavKey;
  href: string;
  label: string;
  /** 사이드바 그룹. */
  section: AdminNavSectionId;
  /** 어드민 홈 빠른이동 타일로 노출(이 설명과 함께). 없으면 타일 미노출. */
  tileDescription?: string;
  /** 모바일 하단바에 노출(최대 5개). */
  inBottomNav?: boolean;
};

/** 사이드바 섹션 정의(노출 순서 + 제목). title 없으면 헤더 없는 묶음. */
export const ADMIN_NAV_SECTIONS: ReadonlyArray<{
  id: AdminNavSectionId;
  title?: string;
}> = [
  { id: 'main' },
  { id: 'catalog', title: '상품 관리' },
  { id: 'ops', title: '운영' },
  { id: 'settings', title: '설정' },
];

/**
 * 전체 어드민 내비 항목(사이드바 노출 순서대로). 파생 뷰(하단바/타일)는 이 배열을
 * 필터링해 만들므로 순서가 자동 보존된다.
 */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { key: 'dashboard', href: '/admin', label: '대시보드', section: 'main', inBottomNav: true },

  { key: 'categories', href: '/admin/categories', label: '카테고리', section: 'catalog', tileDescription: '상품 라인 생성 · /catalog/<슬러그>' },
  { key: 'products', href: '/admin/products', label: '상품', section: 'catalog', tileDescription: '상품 CRUD, 활성 토글', inBottomNav: true },
  { key: 'frames', href: '/admin/frames', label: '프레임', section: 'catalog', tileDescription: '컬러별 PNG + inner_rect' },
  { key: 'options', href: '/admin/options', label: '옵션', section: 'catalog', tileDescription: '사이즈/색상/매트/인화지 매트릭스, CSV 일괄 등록' },

  { key: 'orders', href: '/admin/orders', label: '주문', section: 'ops', tileDescription: '주문 조회 및 상태 전이', inBottomNav: true },
  { key: 'reviews', href: '/admin/reviews', label: '리뷰', section: 'ops' },
  // FS-X-05: 문의/쿠폰 — 하단바 미포함(5개 만석), 타일 미노출(아이콘 맵은 표면별 로컬).
  { key: 'inquiries', href: '/admin/inquiries', label: '문의', section: 'ops' },
  { key: 'coupons', href: '/admin/coupons', label: '쿠폰', section: 'ops' },
  { key: 'curation', href: '/admin/curation', label: '큐레이션', section: 'ops', tileDescription: '랜딩 배너/컬렉션/feature', inBottomNav: true },
  { key: 'artworks', href: '/admin/artworks', label: '명화', section: 'ops' },
  { key: 'landing', href: '/admin/landing', label: '랜딩 관리', section: 'ops' },

  { key: 'shipping', href: '/admin/shipping', label: '배송 설정', section: 'settings', tileDescription: 'STANDARD/PICKUP/QUICK 요금' },
  { key: 'settings', href: '/admin/settings', label: '설정', section: 'settings', inBottomNav: true },
];

/** 섹션별 항목(노출 순서 보존). */
export function adminNavBySection(section: AdminNavSectionId): AdminNavItem[] {
  return ADMIN_NAV.filter((item) => item.section === section);
}

/** 모바일 하단바 항목(최대 5). */
export function adminBottomNavItems(): AdminNavItem[] {
  return ADMIN_NAV.filter((item) => item.inBottomNav);
}

/** 어드민 홈 빠른이동 타일 항목(tileDescription 보유 항목). */
export function adminTileItems(): AdminNavItem[] {
  return ADMIN_NAV.filter((item) => item.tileDescription != null);
}

/** 현재 경로가 해당 항목 활성 상태인지. /admin 은 정확 일치, 그 외는 prefix. */
export function isAdminNavActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname.startsWith(href);
}
