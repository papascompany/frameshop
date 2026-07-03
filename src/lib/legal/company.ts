/**
 * COMPANY — 사업자 정보 단일 소스(SSOT). FS-EC-05.
 *
 * Footer · /terms · /privacy 등 법적 고지가 필요한 모든 화면은 이 모듈만
 * 참조한다. 값 하드코딩 산재 금지.
 *
 * TODO(CTO): 실값 확정 — 아래 값은 기존 Footer에 게시돼 있던
 * (주)파파스컴퍼니 사업자 정보를 이전한 것. FrameShop 서비스 명의
 * (상호·통신판매업신고번호·주소·연락처)가 이 법인/신고번호로 확정인지
 * 검토 후 이 파일에서만 갱신할 것. `(확정 필요)`가 붙은 값은 placeholder.
 */
export const COMPANY = {
  /** 상호(법인명) */
  name: '(주)파파스컴퍼니',
  /** 서비스명 */
  serviceName: 'FrameShop',
  /** 대표자 */
  ceo: '조요한',
  /** 사업자등록번호 */
  businessRegistrationNo: '276-88-00212',
  /** 통신판매업신고번호 — TODO(CTO): FrameShop 명의 신고 여부 확정 필요 */
  mailOrderSalesNo: '2016-서울강남-00140',
  /** 대표전화(표기용) */
  phone: '02-2273-5131',
  /** 대표전화(tel: 링크용) */
  phoneHref: 'tel:0222735131',
  /** 고객문의 이메일 — TODO(CTO): 실 이메일 확정 필요(placeholder) */
  email: 'help@papascompany.co.kr(확정 필요)',
  /** 본사 주소 */
  addressHq: '서울시 종로구 지봉로4길 19 시즌빌딩 1층 i-15호',
  /** 제작본부 주소 */
  addressFactory: '경기도 고양시 덕양구 통일로 140 삼송테크노밸리 B동 4층 422호',
  /** 개인정보 보호책임자 */
  privacyOfficer: '조요한',
  /** 호스팅 사업자 표기 — TODO(CTO): 실제 인프라(Vercel/Supabase) 기준 표기 확정 필요 */
  hosting: 'AWS',
  /** 카카오 채널 */
  kakaoChannel: '@frameshop',
  /** 고객센터 운영시간 */
  businessHours: '평일 10:00 – 18:00',
  /** 프로그램등록번호 */
  programRegistrations: [
    'C-2016-017298(Printable)',
    'C-2016-017299(Pages Converter)',
  ],
  /** 특허등록번호 */
  patentNo: '제 10-2711423 호(콘티제네레이터)',
} as const;

/**
 * 개인정보 처리위탁 수탁사 목록 — /privacy 처리위탁 조항에서 사용.
 *
 * TODO(CTO): 실 계약 기준 확정 필요 — 배송사(택배사) 상호, 국외 이전
 * (Vercel/Supabase 법인 소재지 미국 — 데이터 리전은 서울) 고지 문구는
 * 법률 자문 시 함께 검토할 것.
 */
export const PRIVACY_PROCESSORS = [
  {
    name: '토스페이먼츠(주)',
    task: '신용카드 등 전자결제 처리 및 결제 도용 방지',
  },
  {
    name: '배송사(택배사) — (확정 필요)',
    task: '주문 상품의 배송(수령인 성명·연락처·주소 제공)',
  },
  {
    name: 'Vercel Inc.(확정 필요 — 국외: 미국)',
    task: '웹 서비스 호스팅 인프라 운영',
  },
  {
    name: 'Supabase Inc.(확정 필요 — 국외 법인, 데이터 리전: 서울)',
    task: '데이터베이스·업로드 이미지 저장 인프라 운영',
  },
] as const;

/**
 * 법적 문서(약관·방침) 시행일 — TODO(CTO): 법률 자문 완료 후 확정.
 */
export const LEGAL_EFFECTIVE_DATE = '2026-07-03(초안 작성일 — 시행일 확정 필요)';

/**
 * 법률 자문 전 초안 고지 — /terms, /privacy 페이지 하단 공통 문구.
 */
export const LEGAL_DRAFT_NOTICE =
  '본 문서는 법률 자문 전 초안입니다. 정식 시행 전 법률 전문가의 검토를 거쳐 확정되며, 확정 전까지 내용이 변경될 수 있습니다.';
