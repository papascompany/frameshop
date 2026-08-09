import Image from 'next/image';
import Link from 'next/link';
import { Container } from './Container';
import { getLegalInfo } from '@/lib/legal/company-settings';

/**
 * Site footer — 사업자 정보 + 카탈로그·주문·법적 고지 링크.
 *
 * 사업자 실값은 src/lib/legal/company.ts(SSOT)만 참조한다 (FS-EC-05).
 */
export async function Footer() {
  // 확정 대기 값(통신판매업신고번호·호스팅 표기 등)은 어드민 설정에서
  // 덮어쓸 수 있다 — 미설정이면 company.ts 정적 값 그대로.
  const { company: COMPANY } = await getLegalInfo();
  return (
    <footer className="mt-auto bg-canvas border-t border-hairline">
      <Container size="xl" className="py-12">

        {/* ── 상단 링크 컬럼 ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-10">
          {/* 카탈로그 */}
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
                <span className="caption-md text-mute opacity-60 cursor-default" title="준비 중">
                  프리미엄 액자 (준비 중)
                </span>
              </li>
              <li>
                <span className="caption-md text-mute opacity-60 cursor-default" title="준비 중">
                  포토 프린트 (준비 중)
                </span>
              </li>
            </ul>
          </div>

          {/* 주문 */}
          <div className="flex flex-col gap-3">
            <p className="body-strong text-ink">주문</p>
            <ul className="flex flex-col gap-2">
              <li>
                <Link href="/order/lookup" className="caption-md text-mute hover:text-ink transition-colors">
                  주문조회
                </Link>
              </li>
              <li>
                <Link href="/#faq" className="caption-md text-mute hover:text-ink transition-colors">
                  자주 묻는 질문
                </Link>
              </li>
            </ul>
          </div>

          {/* 고객센터 */}
          <div className="flex flex-col gap-3">
            <p className="body-strong text-ink">고객센터</p>
            <ul className="flex flex-col gap-2 caption-md text-mute">
              <li>
                대표전화:{' '}
                <a href={COMPANY.phoneHref} className="hover:text-ink transition-colors">
                  {COMPANY.phone}
                </a>
              </li>
              <li>{COMPANY.businessHours}</li>
              <li>카카오 채널: {COMPANY.kakaoChannel}</li>
            </ul>
          </div>
        </div>

        <hr className="border-t border-hairline mb-8" />

        {/* ── 사업자 정보 ─────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
          {/* 로고 */}
          <div className="shrink-0">
            <Image
              src="/papas-logo.png"
              alt="파파스컴퍼니 로고"
              width={120}
              height={34}
              className="opacity-80"
              priority={false}
            />
          </div>

          {/* 텍스트 정보 */}
          <div className="utility-xs text-mute leading-relaxed space-y-1">
            <p>
              {COMPANY.name}&nbsp;&nbsp;|&nbsp;&nbsp;대표자: {COMPANY.ceo}&nbsp;&nbsp;|&nbsp;&nbsp;사업자등록번호: {COMPANY.businessRegistrationNo}&nbsp;&nbsp;|&nbsp;&nbsp;대표전화: {COMPANY.phone}
            </p>
            <p>
              제작본부: {COMPANY.addressFactory}
            </p>
            <p>
              본사: {COMPANY.addressHq}
            </p>
            <p>
              개인정보보호 책임자: {COMPANY.privacyOfficer}&nbsp;&nbsp;|&nbsp;&nbsp;호스팅: {COMPANY.hosting}
            </p>
            <p>
              통신판매업신고: {COMPANY.mailOrderSalesNo}
            </p>
            <p>
              프로그램등록번호: {COMPANY.programRegistrations.join(', ')}
            </p>
            <p>
              특허등록번호: {COMPANY.patentNo}
            </p>
          </div>
        </div>

        <hr className="my-6 border-t border-hairline" />

        {/* ── 카피라이트 & 법적 링크 ──────────────────────────────────── */}
        <div className="flex flex-col md:flex-row gap-2 md:justify-between utility-xs text-mute">
          <p>© 2026 PapasCompany Archive. All rights reserved.</p>
          <p>
            <Link href="/terms" className="hover:text-ink transition-colors underline underline-offset-2">
              이용약관
            </Link>
            <span className="mx-2">·</span>
            <Link href="/privacy" className="hover:text-ink transition-colors underline underline-offset-2">
              개인정보처리방침
            </Link>
          </p>
        </div>

      </Container>
    </footer>
  );
}
