/**
 * Sentry 클라이언트 사이드 설정.
 *
 * NEXT_PUBLIC_SENTRY_DSN이 있을 때만 활성화.
 * Vercel 환경변수에 NEXT_PUBLIC_SENTRY_DSN을 추가하면 자동으로 활성화됨.
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // 개발 환경에서 console 로그 최소화
  debug: false,
});
