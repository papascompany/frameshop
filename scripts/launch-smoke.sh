#!/usr/bin/env bash
# FrameShop 런칭 스모크 — 부수효과 없는 HTTP 점검.
#
# 사용법:  bash scripts/launch-smoke.sh <BASE_URL>
#          npm run smoke:launch -- https://frameshop-snowy.vercel.app
#
# 오픈 당일과 매 배포 후 실행한다. 항목별 PASS/FAIL/INFO 표를 출력하고,
# FAIL 이 하나라도 있으면 exit 1.
#
# 이 스크립트가 절대 하지 않는 것:
#   - PAYMENT_STATUS_CHANGED 웹훅 전송 (Toss 결제 조회 API 호출을 유발)
#   - 주문·업로드·장바구니 생성, 인증 헤더(Authorization/Cookie) 사용
#   - 재시도, 리다이렉트 추적, 비밀값(키 본문) 출력
# 보내는 요청은 GET 과, 웹훅 수신기가 아무 처리 없이 거절/확인만 하는
# POST 2건(not-json → 400, DEPOSIT_CALLBACK → 200) 뿐이다.
#
# 주의: /api/cron/* 은 CRON_SECRET 미설정 + NODE_ENV!=production 이면 인증 없이
# 실행된다(next dev). 그런 대상에서 GET 하면 실제 스윕이 돌므로, localhost/사설
# 대상에서는 cron 점검을 건너뛴다(INFO).

set -euo pipefail

if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo "usage: bash scripts/launch-smoke.sh <BASE_URL>" >&2
  exit 2
fi

BASE_URL="${1%/}"
if [[ ! "$BASE_URL" =~ ^https?://[^/]+$ ]]; then
  echo "BASE_URL 은 경로 없는 origin 이어야 합니다 (예: https://example.com): $1" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BODY="$TMP_DIR/body"
HEADERS="$TMP_DIR/headers"

RESULTS=()
FAIL_COUNT=0

# record <PASS|FAIL|INFO> <name> <detail>
record() {
  RESULTS+=("$1"$'\t'"$2"$'\t'"$3")
  if [[ "$1" == "FAIL" ]]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# fetch <METHOD> <PATH> [BODY]  → HTTP 상태코드를 출력(연결 실패/타임아웃은 000).
# 본문은 $BODY, 응답 헤더는 $HEADERS 에 저장. 재시도·리다이렉트 추적 없음.
fetch() {
  local method="$1" path="$2" data="${3-}"
  local -a args=(-sS -m 20 -o "$BODY" -D "$HEADERS" -w '%{http_code}' -X "$method")
  if [[ $# -ge 3 ]]; then
    args+=(-H 'Content-Type: application/json' --data-binary "$data")
  fi
  : >"$BODY"
  : >"$HEADERS"
  curl "${args[@]}" "$BASE_URL$path" 2>"$TMP_DIR/curl.err" || true
}

# header_value <name> → 마지막 응답의 헤더 값(소문자 이름 매칭, CR 제거).
header_value() {
  grep -i "^$1:" "$HEADERS" | tail -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//' || true
}

body_has() {
  grep -qF -- "$1" "$BODY"
}

# ---------------------------------------------------------------------------
# 1. 홈 + 보안 헤더
code="$(fetch GET /)"
if [[ "$code" == "200" ]]; then
  record PASS "GET /" "200"
else
  record FAIL "GET /" "status=$code (기대 200)"
fi
for h in content-security-policy strict-transport-security x-frame-options x-content-type-options; do
  v="$(header_value "$h")"
  if [[ -n "$v" ]]; then
    record PASS "header $h" "present"
  else
    record FAIL "header $h" "missing on /"
  fi
done

# 2. robots.txt
code="$(fetch GET /robots.txt)"
if [[ "$code" != "200" ]]; then
  record FAIL "GET /robots.txt" "status=$code (기대 200)"
else
  missing=()
  for p in /admin /api; do
    grep -qiE "^Disallow:[[:space:]]*${p}[[:space:]]*\$" <(tr -d '\r' <"$BODY") || missing+=("$p")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    record PASS "GET /robots.txt" "Disallow /admin, /api"
  else
    record FAIL "GET /robots.txt" "Disallow 누락: ${missing[*]}"
  fi
fi

# 3. sitemap.xml — 모든 <loc> 가 대상 origin 으로 시작
code="$(fetch GET /sitemap.xml)"
if [[ "$code" != "200" ]]; then
  record FAIL "GET /sitemap.xml" "status=$code (기대 200)"
else
  total="$(grep -oE '<loc>[^<]*</loc>' "$BODY" | wc -l | tr -d ' ')"
  foreign="$(grep -oE '<loc>[^<]*</loc>' "$BODY" | grep -cvF "<loc>$BASE_URL" || true)"
  if [[ "$total" -eq 0 ]]; then
    record FAIL "GET /sitemap.xml" "<loc> 0건"
  elif [[ "$foreign" -gt 0 ]]; then
    sample="$(grep -oE '<loc>[^<]*</loc>' "$BODY" | grep -vF "<loc>$BASE_URL" | head -n 1 | sed -E 's#</?loc>##g')"
    record FAIL "GET /sitemap.xml" "$foreign/$total <loc> 가 다른 origin (예: $sample)"
  else
    record PASS "GET /sitemap.xml" "$total <loc> 모두 $BASE_URL"
  fi
fi

# 4. /payment/success (파라미터 없음) → /cart 리다이렉트
code="$(fetch GET /payment/success)"
location="$(header_value location)"
if [[ "$code" =~ ^30[1278]$ && "$location" == *"/cart"* ]]; then
  record PASS "GET /payment/success (no params)" "$code → $location"
elif [[ "$code" == "200" ]] && body_has '__next-page-redirect' \
  && grep -qE '__next-page-redirect[^>]*url=/cart|url=/cart[^>]*__next-page-redirect' "$BODY"; then
  record PASS "GET /payment/success (no params)" "200 + meta refresh → /cart"
else
  record FAIL "GET /payment/success (no params)" "status=$code, /cart 리다이렉트 없음"
fi

# 5. /payment/success 잘못된 파라미터 → 입력 검증에서 거절(Toss 호출 전 단계)
code="$(fetch GET '/payment/success?paymentKey=smoke&orderId=bad&amount=1')"
if [[ "$code" == "200" ]] && body_has '결제 정보가 올바르지 않습니다'; then
  record PASS "GET /payment/success (bad params)" "200 + 검증 거절 메시지"
else
  record FAIL "GET /payment/success (bad params)" "status=$code, 거절 메시지 없음"
fi

# 6. 결제 웹훅 — 파싱 불가 본문
code="$(fetch POST /api/webhook/payment 'not-json')"
if [[ "$code" == "400" ]] && body_has '"code":"BAD_JSON"'; then
  record PASS "POST webhook (not-json)" "400 BAD_JSON"
else
  record FAIL "POST webhook (not-json)" "status=$code body=$(head -c 120 "$BODY" | tr -d '\r\n\t')"
fi

# 7. 결제 웹훅 — 구독하지 않은 이벤트(처리 없이 200)
code="$(fetch POST /api/webhook/payment '{"eventType":"DEPOSIT_CALLBACK","data":{"paymentKey":"smoke-test"}}')"
if [[ "$code" == "200" ]] && body_has '{"ok":true}'; then
  record PASS "POST webhook (DEPOSIT_CALLBACK)" '200 {"ok":true}'
else
  record FAIL "POST webhook (DEPOSIT_CALLBACK)" "status=$code body=$(head -c 120 "$BODY" | tr -d '\r\n\t')"
fi

# 8. cron 라우트 — 인증 없이 401
host="${BASE_URL#*://}"
host="${host%%:*}"
if [[ "$host" =~ ^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|\[::1\]) ]]; then
  record INFO "GET /api/cron/*" "로컬/사설 대상 — 건너뜀(dev 에서는 인증 없이 실행될 수 있음)"
else
  for p in /api/cron/payment-sweep /api/cron/render-retry; do
    code="$(fetch GET "$p")"
    if [[ "$code" == "401" ]]; then
      record PASS "GET $p (no auth)" "401"
    else
      record FAIL "GET $p (no auth)" "status=$code (기대 401)"
    fi
  done
fi

# 9. /checkout — 페이지 + Toss 클라이언트 키 구성 여부(접두사만, 본문 마스킹)
code="$(fetch GET /checkout)"
if [[ "$code" == "200" ]]; then
  record PASS "GET /checkout" "200"
  # RSC 페이로드의 따옴표는 \" 로 이스케이프되어 있다. 정규식은 접두사까지만
  # 잡으므로 키 본문은 변수에도 담기지 않는다.
  toss="$(grep -oE 'tossClientKey(\\)*"(\\)*:[[:space:]]*(null|(\\)*"(test|live)_|(\\)*")' "$BODY" | head -n 1 || true)"
  if [[ -z "$toss" ]]; then
    record FAIL "checkout tossClientKey" "페이로드에서 tossClientKey 를 찾지 못함"
  elif [[ "$toss" == *null ]]; then
    record INFO "checkout tossClientKey" "미설정 (null) — 결제 제출 시 안내 표시"
  elif [[ "$toss" == *test_ ]]; then
    record INFO "checkout tossClientKey" "설정됨: test_*** (테스트 키)"
  elif [[ "$toss" == *live_ ]]; then
    record INFO "checkout tossClientKey" "설정됨: live_*** (라이브 키)"
  else
    record FAIL "checkout tossClientKey" "설정됐지만 접두사가 test_/live_ 아님 (값 마스킹)"
  fi
else
  record FAIL "GET /checkout" "status=$code (기대 200)"
  record FAIL "checkout tossClientKey" "페이지 응답 없음"
fi

# ---------------------------------------------------------------------------
echo "FrameShop launch smoke — $BASE_URL"
echo
printf '%-6s  %-40s  %s\n' "RESULT" "CHECK" "DETAIL"
printf '%-6s  %-40s  %s\n' "------" "----------------------------------------" "------"
for row in "${RESULTS[@]}"; do
  IFS=$'\t' read -r status name detail <<<"$row"
  printf '%-6s  %-40s  %s\n' "$status" "$name" "$detail"
done
echo
pass_count="$(printf '%s\n' "${RESULTS[@]}" | grep -c '^PASS' || true)"
info_count="$(printf '%s\n' "${RESULTS[@]}" | grep -c '^INFO' || true)"
echo "PASS=$pass_count FAIL=$FAIL_COUNT INFO=$info_count"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
