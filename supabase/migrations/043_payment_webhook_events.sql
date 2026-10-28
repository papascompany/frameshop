-- 043_payment_webhook_events.sql
--
-- Toss 결제 웹훅 수신 감사 로그 (결제 웹훅 정합성 — BACKLOG §0 "웹훅 후속 2건").
--
-- 배경: payment_events 는 payment_key UNIQUE 라 같은 결제의 두 번째 이후 상태(예: Toss
--   대시보드 취소 CANCELED, PARTIAL_CANCELED)를 기록할 수 없었다. payment_events 는
--   confirm ↔ 웹훅 사이의 DONE 원자 락으로 계속 쓰므로 건드리지 않고, 웹훅 수신 전부를
--   이 테이블에 남긴다. 상태 반영은 웹훅 본문이 아니라 Toss 결제 조회 결과(toss_status)로 한다.
--
-- 비파괴(non-destructive): 신규 테이블만 추가한다. 기존 데이터·제약 변경 없음.
-- 멱등(idempotent): IF NOT EXISTS 로 재실행 안전.
--
-- ★ 미적용 안전성(graceful): 적용하지 않아도 웹훅 처리(상태 반영)는 정상 동작한다.
--   feature-probe(isWebhookAuditAvailable)가 false 면 감사 기록만 생략한다.

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- tosspayments-webhook-transmission-id. 재전송은 같은 값일 수 있어 UNIQUE 로 두지 않는다
  -- (재전송마다 처리 결과가 다를 수 있다 — 예: 첫 수신 deferred, 재전송 cancel_applied).
  transmission_id  text,
  retried_count    integer,
  event_type       text NOT NULL,
  payment_key      text NOT NULL,
  order_no         text,
  -- Toss 결제 조회로 확인한 권위 상태. 조회 실패 시 NULL.
  toss_status      text,
  -- 처리 결과(settled_paid / cancel_applied / deferred / amount_mismatch / ...).
  outcome          text NOT NULL,
  raw_payload      jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE payment_webhook_events IS
  'Toss 웹훅 수신 감사 로그(043). 상태 반영 근거는 toss_status(결제 조회 결과)이며 '
  'raw_payload 는 수신 원문. payment_events(DONE 락)와 별개.';

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_payment_key
  ON payment_webhook_events (payment_key);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_received
  ON payment_webhook_events (received_at DESC);

-- ─── RLS: payment_events(012) 와 동일 — 정책 없음 = service-role 전용 ─────────────
ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policy. 웹훅 라우트(service-role)만 기록·조회한다.
