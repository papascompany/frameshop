import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Next.js 16 config (App Router).
 *
 * Performance posture for FrameShop:
 *  1. `images.remotePatterns` whitelists Supabase Storage (public objects only)
 *     and Unsplash CDN (editorial photography on the landing/marketing pages).
 *  2. AVIF first, WebP fallback — gallery hero shots are large, AVIF cuts
 *     ~20% off WebP at equivalent SSIM.
 *  3. `experimental.optimizePackageImports` lets Next tree-shake barrel files
 *     for the design-system / Zod entry points we touch from RSC.
 *  4. `experimental.staleTimes` keeps client-side Router Cache warm so
 *     landing → catalog → product navigations feel instant after the first
 *     hit (Next 16 default is short; we lift `dynamic` to 30s to mask the
 *     Supabase RTT on warm sessions).
 *
 *  Note: turbopack root pin is preserved to silence the workspace-root
 *  warning when running `next dev` from the worktree.
 */
// ─── HTTP Security Headers ────────────────────────────────────────────────────
// Applied to all routes. Provides baseline browser-level hardening.
// INFO-002 FIX: security headers were completely absent before this change.
const SUPABASE_HOSTNAME = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname   // e.g. abc123.supabase.co
  : 'acxsxjmqgvkceqahwkpz.supabase.co';

const securityHeaders = [
  // Prevent MIME-type sniffing (mitigates SVG-XSS and content-type spoofing).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Clickjacking protection — our site should never be framed.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Force HTTPS for 1 year and include sub-domains.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Limit referrer info sent to cross-origin destinations.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable browser features we don't use.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Content Security Policy:
  // - script-src includes 'unsafe-inline' for Next.js RSC hydration + JSON-LD
  //   inline scripts. A nonce-based CSP is the next hardening step (Phase 2).
  // - Toss Payments loads its SDK from js.tosspayments.com.
  // - connect-src covers Supabase Realtime/Storage + Toss API.
  // - frame-ancestors 'none' is stricter than X-Frame-Options for modern browsers.
  {
    key: 'Content-Security-Policy',
    value: [
      `default-src 'self'`,
      `script-src 'self' 'unsafe-inline' https://js.tosspayments.com`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob: https://${SUPABASE_HOSTNAME} https://lh3.googleusercontent.com https://images.unsplash.com`,
      `font-src 'self' data:`,
      `connect-src 'self' https://${SUPABASE_HOSTNAME} https://api.tosspayments.com wss://${SUPABASE_HOSTNAME}`,
      `frame-src https://js.tosspayments.com`,
      `frame-ancestors 'none'`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `upgrade-insecure-requests`,
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },

  // MEDIUM-002 FIX: apply security headers to all routes.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },

  images: {
    remotePatterns: [
      {
        // INFO-003 FIX: restrict to the specific project subdomain instead of *.supabase.co
        protocol: 'https',
        hostname: SUPABASE_HOSTNAME,
        pathname: '/storage/v1/object/**',
      },
      // Google Photos base URLs (picker에서 직접 표시할 때 필요)
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      // Unsplash — DB에 저장된 상품 썸네일이 아직 images.unsplash.com URL을 참조함.
      // 미러링 스크립트(scripts/mirror-unsplash.mjs)로 Supabase Storage로 이전 완료 후
      // DB URL 업데이트가 완료되면 이 항목을 제거.
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    // Pre-generate srcSet for the breakpoints we actually use:
    //  - 360 = mobile small  / 640 = mobile xl
    //  - 750 = tablet         / 1080 = desktop std
    //  - 1280 = desktop wide  / 1920 = retina hero
    deviceSizes: [360, 640, 750, 1080, 1280, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    // Cache transformed images for 1 day at the edge.
    minimumCacheTTL: 60 * 60 * 24,
  },

  experimental: {
    // Tree-shake barrel imports for design-system + validation entry points.
    optimizePackageImports: [
      '@/components/ui',
      '@/components/layout',
      '@/components/marketing',
      'zod',
    ],
    // Keep client-side Router Cache fresh longer to mask Supabase RTT
    // when users bounce between landing → catalog → product → cart.
    staleTimes: {
      dynamic: 30,   // 기존 유지
      static: 180,   // static 페이지 3분 클라이언트 캐시
    },
  },

  // Strip console.* in production except warn/error so we keep observability
  // without paying for verbose logs.
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['warn', 'error'] }
        : false,
  },
};

// next-intl 플러그인 — i18n/request.ts를 자동 연결.
// URL 변경 없음(쿠키 기반 locale 감지).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Sentry 래핑 — DSN 없으면 no-op (빌드 타임에 SENTRY_AUTH_TOKEN 불필요)
export default withSentryConfig(withNextIntl(nextConfig), {
  // Sentry Organization + Project는 환경변수에서 읽음 (선택사항)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // 소스맵 업로드는 인증 토큰이 있을 때만 (없으면 skip)
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // 소스맵 설정 — 프로덕션 번들에서 소스맵 제거
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Sentry 관련 로그 최소화
  silent: true,
  // 텔레메트리 비활성 (불필요한 트래픽 방지)
  telemetry: false,
});
