import Image from 'next/image';
import Link from 'next/link';
import { Container } from './Container';

/**
 * Site footer — (주)파파스컴퍼니 사업자 정보 + 카탈로그·주문 링크.
 */
export function Footer() {
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
              <li>대표전화: <a href="tel:0222735131" className="hover:text-ink transition-colors">02-2273-5131</a></li>
              <li>평일 10:00 – 18:00</li>
              <li>카카오 채널: @frameshop</li>
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
              (주)파파스컴퍼니&nbsp;&nbsp;|&nbsp;&nbsp;대표자: 조요한&nbsp;&nbsp;|&nbsp;&nbsp;사업자등록번호: 276-88-00212&nbsp;&nbsp;|&nbsp;&nbsp;대표전화: 02-2273-5131
            </p>
            <p>
              제작본부: 경기도 고양시 덕양구 통일로 140 삼송테크노밸리 B동 4층 422호
            </p>
            <p>
              본사: 서울시 종로구 지봉로4길 19 시즌빌딩 1층 i-15호
            </p>
            <p>
              개인정보보호 책임자: 조요한&nbsp;&nbsp;|&nbsp;&nbsp;호스팅: AWS
            </p>
            <p>
              통신판매업신고: 2016-서울강남-00140
            </p>
            <p>
              프로그램등록번호: C-2016-017298(Printable), C-2016-017299(Pages Converter)
            </p>
            <p>
              특허등록번호: 제 10-2711423 호(콘티제네레이터)
            </p>
          </div>
        </div>

        <hr className="my-6 border-t border-hairline" />

        {/* ── 카피라이트 & 법적 링크 ──────────────────────────────────── */}
        <div className="flex flex-col md:flex-row gap-2 md:justify-between utility-xs text-mute">
          <p>© 2026 PapasCompany Archive. All rights reserved.</p>
          <p>
            <span className="cursor-default opacity-70" title="게시 예정">이용약관</span>
            <span className="mx-2">·</span>
            <span className="cursor-default opacity-70" title="게시 예정">개인정보처리방침</span>
          </p>
        </div>

      </Container>
    </footer>
  );
}
