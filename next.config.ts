import type { NextConfig } from 'next';

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
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/photo-*',
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

export default nextConfig;
