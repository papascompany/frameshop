import { Bebas_Neue } from 'next/font/google';
import localFont from 'next/font/local';

/**
 * Display tier — Bebas Neue (Nike Futura ND substitute).
 *
 *  Loaded via `next/font/google` so the binary is self-hosted at build time.
 *  No render-blocking `<link rel="stylesheet" href="fonts.googleapis.com">`
 *  hops; the font shows up as `var(--font-display)`.
 */
export const fontDisplay = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-display',
  preload: true,
});

/**
 * UI tier — Pretendard Variable, self-hosted from `public/fonts/`.
 *
 *  Earlier the project pulled this from jsdelivr.net via CSS `@font-face`,
 *  which added a 200–500 ms blocking dependency for first paint on Korean
 *  mobile networks. We now ship the file with the build and let
 *  `next/font/local` emit a tagged `@font-face` block with `font-display:
 *  swap`. The CSS variable `--font-sans` is wired into Tailwind tokens
 *  via `globals.css @theme inline`.
 */
export const fontSans = localFont({
  src: [
    {
      path: '../../public/fonts/PretendardVariable.woff2',
      weight: '45 920',
      style: 'normal',
    },
  ],
  variable: '--font-sans',
  display: 'swap',
  preload: true,
  // Fallback metrics roughly match Pretendard's x-height to avoid CLS.
  fallback: [
    'Inter',
    'Spoqa Han Sans Neo',
    '-apple-system',
    'BlinkMacSystemFont',
    'system-ui',
    'Apple SD Gothic Neo',
    'Malgun Gothic',
    'sans-serif',
  ],
});
