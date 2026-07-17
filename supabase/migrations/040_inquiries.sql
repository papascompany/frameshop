-- 040_inquiries.sql
--
-- 1:1 문의(고객센터). 결정: ADR-026 (FS-X-00 계약 동결).
--
-- 비파괴(non-destructive): 신규 테이블만 추가한다. 데이터 변경 없음.
-- 멱등(idempotent): IF NOT EXISTS / DROP POLICY IF EXISTS 로 재실행 안전.
--
-- ★ 미적용 안전성(graceful): 이 마이그레이션을 적용하지 않아도 앱은 정상 동작한다.
--   feature-probe(isInquiriesAvailable)가 false 를 돌려 문의 작성/목록·admin/inquiries
--   UI 를 숨긴다(42P01 노출 금지).
--
-- 정책(ADR-026): 문의는 전부 비공개(비밀글 고정) — 공개 SELECT 정책 없음.
--   작성자 본인(owner-select) + 관리자(service-role)만 읽는다. 비회원 문의는
--   user_id NULL 로 서버 라우트(service-role + 코드 레벨 스코핑)를 통해서만
--   생성/조회된다. 답변 알림은 contact_email 로 발송(notifyInquiryReplied).

CREATE TABLE IF NOT EXISTS inquiries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 회원 탈퇴 시 문의는 남기고 연결만 끊는다(운영 기록 보존).
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id      uuid REFERENCES orders(id) ON DELETE SET NULL,
  product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  contact_email text NOT NULL,
  category      text,
  subject       text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN', 'ANSWERED', 'CLOSED')),
  admin_reply   text,
  answered_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inquiries IS
  '1:1 문의(전부 비공개 — 비밀글 고정, ADR-026). 작성자 본인 + service-role 만 읽는다. '
  '비회원 문의는 user_id NULL(서버 라우트 경유). 앱 검증 SSOT: src/types/inquiry.ts.';
COMMENT ON COLUMN inquiries.contact_email IS
  '답변 알림 수신 이메일(회원/비회원 공통 필수) — notifyInquiryReplied 수신처.';
COMMENT ON COLUMN inquiries.status IS
  'OPEN(접수) → ANSWERED(답변 완료, answered_at 기록) → CLOSED(종결).';
COMMENT ON COLUMN inquiries.admin_reply IS
  '관리자 답변 본문(service-role UPDATE 전용). NULL = 미답변.';

-- 목록 조회(본인 문의 최신순) + 관리자 필터(status) + FK 인덱스.
CREATE INDEX IF NOT EXISTS idx_inquiries_user_created
  ON inquiries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries (status);
CREATE INDEX IF NOT EXISTS idx_inquiries_order ON inquiries (order_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_product ON inquiries (product_id);

-- ─── RLS: owner-select + own-insert. 답변(UPDATE)·전체 목록은 service-role 전용 ─────
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inquiries_owner_select ON inquiries;
CREATE POLICY inquiries_owner_select ON inquiries
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 본인 명의 INSERT 만 허용(user_id 스푸핑 차단). 비회원(user_id NULL)은 이 정책을
-- 통과하지 못한다 — 비회원 문의는 서버 라우트의 service-role 이 생성한다(의도).
DROP POLICY IF EXISTS inquiries_own_insert ON inquiries;
CREATE POLICY inquiries_own_insert ON inquiries
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
-- UPDATE/DELETE 정책 없음 = 답변·종결·삭제는 service-role(관리자) 전용.
