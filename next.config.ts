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
const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      // Google Photos base URLs (picker에서 직접 표시할 때 필요)
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      // Unsplash entry removed — all editorial photos are now mirrored to
      // Supabase Storage (marketing bucket) via scripts/mirror-unsplash.mjs (P1-07).
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
      dynamic: 30,
      static: 300,
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
