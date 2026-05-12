import Link from 'next/link';
import { Container } from './Container';

/**
 * Site footer — Nike-aligned, Phase-1 trimmed.
 *
 *  Phase 1 reality (2026-05-12 ops): the `/help/*`, `/legal/*`, `/about`
 *  routes do not exist yet, so every prefetched footer link 404s and floods
 *  the console. Until Phase 2 publishes those pages, the footer keeps only
 *  the columns whose targets are real:
 *
 *   - Catalog: just the active "basic-frame" slug.
 *   - 주문: order lookup + a same-page anchor to the landing FAQ section.
 *   - 회사: pure text (no links), email + KakaoTalk channel mention only.
 *
 *  The copyright row preserves the 이용약관 / 개인정보처리방침 labels for
 *  legal visibility, but renders them as text (no `<Link>`) with a
 *  "Phase 2 게시 예정" title attr so users can tell they're not broken
 *  links. Re-enable Phase 2.
 */
export function Footer() {
  return (
    <footer className="mt-auto bg-canvas border-t border-hairline">
      <Container size="xl" className="py-12">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
          {/* ── Catalog ───────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3">
            <p className="body-strong text-ink">카탈로그</p>
            <ul className="flex flex-col gap-2">
              <li>
                <Link
                  href="/catalog/basic-frame"
                  className="caption-md text-mute hover:text-ink transition-colors"
                >
                  베이직 액자
                </Link>
              </li>
              <li>
                <span
                  className="caption-md text-mute opacity-60 cursor-default"
                  title="Phase 2 출시 예정"
                >
                  프리미엄 액자 (준비 중)
                </span>
              </li>
              <li>
                <span
                  className="caption-md text-mute opacity-60 cursor-default"
                  title="Phase 2 출시 예정"
                >
                  포토 프린트 (준비 중)
                </span>
              </li>
            </ul>
          </div>

          {/* ── Orders & Help ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-3">
            <p className="body-strong text-ink">주문</p>
            <ul className="flex flex-col gap-2">
              <li>
                <Link
                  href="/order/lookup"
                  className="caption-md text-mute hover:text-ink transition-colors"
                >
                  주문조회
                </Link>
              </li>
              <li>
                <Link
                  href="/#faq"
                  className="caption-md text-mute hover:text-ink transition-colors"
                >
                  자주 묻는 질문
                </Link>
              </li>
            </ul>
          </div>

          {/* ── Company (text-only contact) ───────────────────────────── */}
          <div className="flex flex-col gap-3">
            <p className="body-strong text-ink">회사</p>
            <ul className="flex flex-col gap-2 caption-md text-mute">
              <li>FrameShop</li>
              <li>평일 10:00 – 18:00</li>
              <li>카카오 채널: @frameshop</li>
            </ul>
          </div>
        </div>
        <hr className="my-8 border-t border-hairline" />
        <div className="flex flex-col md:flex-row gap-2 md:justify-between utility-xs text-mute">
          <p>© {new Date().getFullYear()} FrameShop. All rights reserved.</p>
          <p>
            <span
              className="cursor-default opacity-70"
              title="Phase 2 게시 예정"
            >
              이용약관
            </span>
            <span className="mx-2">·</span>
            <span
              className="cursor-default opacity-70"
              title="Phase 2 게시 예정"
            >
              개인정보처리방침
            </span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
