import type { Metadata } from 'next';
import { Container } from '@/components/layout/Container';
import { LoginClient } from './LoginClient';

export const metadata: Metadata = {
  title: '로그인 — FrameShop',
  description: '관리자 로그인 페이지.',
  robots: { index: false, follow: false }, // never index a login form
};

/**
 * Phase 1 — single login page reached either directly or via the admin
 * middleware redirect (`/admin/* → /login?redirect=/admin/...`).
 *
 *  Email + password only. The Phase 1 user base is the admin team and a
 *  handful of testers; OAuth + magic-link land in Phase 2.
 *
 *  The form lives in `LoginClient` so this Server Component can still ship
 *  metadata cleanly and stay free of the `'use client'` directive.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const sp = await searchParams;
  return (
    <Container size="sm" className="py-16 md:py-24">
      <div className="max-w-[420px] mx-auto">
        <p className="eyebrow mb-4">FRAMESHOP</p>
        <h1
          className="display-campaign mb-2"
          style={{ fontSize: 'clamp(36px, 5vw, 48px)' }}
        >
          SIGN IN
        </h1>
        <p className="caption-md text-mute mb-8">
          관리자 계정으로 로그인하세요. 일반 사용자 계정은 Phase 2에서 출시됩니다.
        </p>
        <LoginClient redirectTo={sp.redirect ?? '/admin'} />
      </div>
    </Container>
  );
}
