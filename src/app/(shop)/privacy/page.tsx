import type { Metadata } from 'next';
import { Container } from '@/components/layout/Container';
import {
  COMPANY,
  PRIVACY_PROCESSORS,
  LEGAL_DRAFT_NOTICE,
  LEGAL_EFFECTIVE_DATE,
} from '@/lib/legal/company';

/**
 * 개인정보처리방침 — 한국 전자상거래 표준 구성 정적 페이지. FS-EC-05.
 *
 * 구성: 수집항목·방법 / 이용목적 / 보유·이용기간(전자상거래법 보존의무) /
 * 제3자 제공 / 처리위탁(토스페이먼츠·배송사·호스팅) / 파기 / 정보주체 권리 /
 * 안전성 확보조치 / 쿠키 / 보호책임자 / 고지의무.
 *
 * 사업자 실값·수탁사 목록은 src/lib/legal/company.ts(SSOT)만 참조한다.
 */

export const metadata: Metadata = {
  title: '개인정보처리방침',
  description: `${COMPANY.serviceName} 개인정보처리방침 — 수집 항목, 이용 목적, 보유 기간, 처리위탁 및 정보주체의 권리를 안내합니다.`,
  alternates: { canonical: '/privacy' },
};

type Section = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
};

const SECTIONS: Section[] = [
  {
    heading: '1. 수집하는 개인정보의 항목 및 수집 방법',
    paragraphs: [
      '회사는 주문·결제·배송 등 서비스 제공을 위하여 다음의 개인정보를 수집합니다.',
    ],
    items: [
      '회원가입 시: 이메일 주소, 비밀번호(또는 소셜 로그인 식별자)',
      '주문·배송 시(회원·비회원 공통): 주문자 성명, 연락처, 수령인 성명, 연락처, 배송지 주소, 배송 요청사항',
      '결제 시: 결제 수단 정보는 결제대행사(토스페이먼츠)가 직접 수집·처리하며, 회사는 결제 승인 결과(승인번호, 결제수단 종류, 금액)만 보관합니다.',
      '제작 서비스 이용 시: 이용자가 업로드한 사진 파일 및 편집 정보(자르기 영역 등)',
      '자동 수집: 서비스 이용기록, 접속 로그, 접속 IP, 쿠키',
    ],
  },
  {
    heading: '2. 개인정보의 수집 및 이용 목적',
    items: [
      '주문 상품의 제작·배송, 주문 내역 조회, 대금 결제 및 환불',
      '회원 관리(본인 확인, 비회원 주문 조회 지원, 고지사항 전달)',
      '고객 문의 응대, 불만 처리 및 분쟁 조정을 위한 기록 보존',
      '주문·배송 상태 알림(알림톡·문자·이메일) 발송',
      '서비스 품질 개선 및 부정 이용 방지',
    ],
  },
  {
    heading: '3. 개인정보의 보유 및 이용 기간',
    paragraphs: [
      '회사는 개인정보의 수집·이용 목적이 달성되면 지체 없이 파기합니다. 다만 관련 법령에 따라 다음 기간 동안 보존합니다.',
    ],
    items: [
      '계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)',
      '대금결제 및 재화 등의 공급에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)',
      '소비자의 불만 또는 분쟁처리에 관한 기록: 3년 (전자상거래 등에서의 소비자보호에 관한 법률)',
      '웹사이트 방문기록(접속 로그): 3개월 (통신비밀보호법)',
      '업로드된 사진 원본: 재제작(불량 대응)·재주문 지원을 위하여 주문 완료 후 일정 기간 보관 후 파기 — 구체적 보관 기간은 확정 후 고지 (확정 필요)',
    ],
  },
  {
    heading: '4. 개인정보의 제3자 제공',
    paragraphs: [
      '회사는 이용자의 개인정보를 제2조에서 고지한 범위를 넘어 제3자에게 제공하지 않습니다. 다만, 이용자가 사전에 동의한 경우 또는 법령의 규정에 의한 경우는 예외로 합니다.',
      '배송을 위하여 수령인 성명·연락처·주소가 배송사에 제공되며, 이는 아래 처리위탁 항목에 따릅니다.',
    ],
  },
  {
    heading: '5. 개인정보 처리의 위탁',
    paragraphs: [
      '회사는 서비스 제공을 위하여 다음과 같이 개인정보 처리 업무를 위탁하고 있으며, 위탁계약 시 개인정보 보호 관련 법규의 준수, 재위탁 제한 등을 명확히 규정합니다.',
    ],
    items: PRIVACY_PROCESSORS.map((p) => `${p.name}: ${p.task}`),
  },
  {
    heading: '6. 개인정보의 파기 절차 및 방법',
    paragraphs: [
      '회사는 보유 기간이 경과하거나 처리 목적이 달성된 개인정보를 지체 없이 파기합니다.',
      '전자적 파일 형태의 정보는 복구할 수 없는 기술적 방법으로 삭제하며, 종이 문서는 분쇄하거나 소각하여 파기합니다.',
    ],
  },
  {
    heading: '7. 정보주체의 권리·의무 및 행사 방법',
    paragraphs: [
      '이용자는 언제든지 자신의 개인정보에 대하여 열람, 정정, 삭제, 처리정지를 요구할 수 있습니다. 권리 행사는 고객센터(전화·카카오 채널) 또는 서면·이메일을 통하여 할 수 있으며, 회사는 지체 없이 조치합니다.',
      '개인정보의 삭제를 요구하더라도 관련 법령에 따라 보존이 의무화된 정보는 보유 기간 동안 보존됩니다.',
    ],
  },
  {
    heading: '8. 개인정보의 안전성 확보 조치',
    items: [
      '개인정보 접근 권한의 최소화 및 접근 통제',
      '전송 구간 암호화(TLS) 및 비밀번호 등 주요 정보의 암호화 저장',
      '접속 기록의 보관 및 위·변조 방지',
      '보안 취약점 점검 및 개선',
    ],
  },
  {
    heading: '9. 쿠키의 운용',
    paragraphs: [
      '회사는 로그인 세션 유지, 장바구니, 비회원 주문 조회 등 서비스 제공을 위하여 쿠키를 사용합니다. 이용자는 브라우저 설정을 통하여 쿠키 저장을 거부할 수 있으나, 이 경우 일부 서비스 이용에 제한이 있을 수 있습니다.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <Container size="md" className="py-10 md:py-14">
      <h1 className="heading-xl mb-2">개인정보처리방침</h1>
      <p className="caption-md text-mute mb-4">
        시행일: {LEGAL_EFFECTIVE_DATE}
      </p>
      <p className="text-sm text-mute leading-relaxed mb-10">
        {COMPANY.name}(이하 &ldquo;회사&rdquo;)는 {COMPANY.serviceName} 서비스를
        운영함에 있어 「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의
        개인정보를 보호하기 위하여 다음과 같이 개인정보처리방침을 수립·공개합니다.
      </p>

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className="body-strong text-ink mb-2">{section.heading}</h2>
            {section.paragraphs ? (
              <div className="space-y-2">
                {section.paragraphs.map((p) => (
                  <p key={p} className="text-sm text-mute leading-relaxed">
                    {p}
                  </p>
                ))}
              </div>
            ) : null}
            {section.items ? (
              <ul className="mt-2 space-y-1 list-disc pl-5">
                {section.items.map((item) => (
                  <li key={item} className="text-sm text-mute leading-relaxed">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <section>
          <h2 className="body-strong text-ink mb-2">
            10. 개인정보 보호책임자
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-mute leading-relaxed">
            <li>개인정보 보호책임자: {COMPANY.privacyOfficer}</li>
            <li>
              연락처: {COMPANY.phone} ({COMPANY.businessHours})
            </li>
            <li>이메일: {COMPANY.email}</li>
            <li>카카오 채널: {COMPANY.kakaoChannel}</li>
          </ul>
          <p className="mt-2 text-sm text-mute leading-relaxed">
            기타 개인정보 침해에 대한 신고나 상담이 필요한 경우 개인정보
            침해신고센터(privacy.kisa.or.kr, 국번 없이 118), 개인정보
            분쟁조정위원회(kopico.go.kr, 1833-6972)에 문의하실 수 있습니다.
          </p>
        </section>

        <section>
          <h2 className="body-strong text-ink mb-2">11. 고지의 의무</h2>
          <p className="text-sm text-mute leading-relaxed">
            이 개인정보처리방침의 내용에 추가, 삭제 및 수정이 있을 경우 시행일
            7일 전부터 서비스 공지사항을 통하여 고지합니다.
          </p>
        </section>
      </div>

      <hr className="my-10 border-t border-hairline" />

      <p className="utility-xs text-mute leading-relaxed">
        {LEGAL_DRAFT_NOTICE}
      </p>
    </Container>
  );
}
