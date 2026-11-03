# 베어메탈 이전 런북 (Vercel + Supabase → 독립 서버)

> 작성 2026-11-03 · 기준 코드 `main@497d77e` · 상태: **계획(미착수)**
> 목적: Vercel(호스팅) + Supabase(DB·인증·파일)로 운영 중인 FrameShop 을 우분투 독립 서버로
> **데이터 손실 없이, 되돌릴 수 있게** 옮기는 절차. 이 문서는 절차서이며 실행 기록은
> `shared/STATUS.md` 에 남긴다.

---

## 0. 요약

| 항목 | 결정·권장 |
|---|---|
| DB | **PostgreSQL 유지**(Supabase 셀프호스팅). MariaDB 는 비권장 — §1 참고 |
| 순서 | **1단계 앱 서버만 이전**(Supabase 클라우드 유지) → **2단계 Supabase 셀프호스팅** |
| 시점 | **런칭 전 권장** — 2026-11-03 기준 실주문 0건(Toss 키 미입력)이라 데이터 이전 위험이 가장 낮다 |
| 1단계만으로 해결되는 것 | Vercel Hobby 상업 이용 불가 문제, 크론 1일 1회 제한, 비공개 레포 배포 Blocked(BL-009) |
| 원칙 | 리허설 없이 운영 전환 금지 · 매 단계 롤백 경로 확보 · 기존 Vercel/Supabase 는 안정화까지 삭제 금지 |

**왜 지금 결정해야 하나**: Vercel 약관상 Hobby 플랜은 비상업 개인 용도 전용이고, "사이트 방문자의
결제를 요청·처리하는 모든 방식"이 상업적 사용으로 명시돼 있다(§9 출처). 런칭하려면 **Vercel Pro 전환**
또는 **이 런북의 1단계** 중 하나가 필요하다.

---

## 1. 현재 의존 인벤토리 (코드 실측, `main@497d77e`)

### Supabase

| 영역 | 실측 | 이전 시 의미 |
|---|---|---|
| DB | PostgreSQL, 테이블 31개, 마이그레이션 001~043. PG 전용 기능 다수(jsonb 26곳, timestamptz 44곳, gen_random_uuid 27곳, pg_trgm·GIN 인덱스, plpgsql 함수 6개 — `apply_points_transaction`·`next_order_no`·`is_admin` 등, 트리거 2개) | PostgreSQL 이면 그대로 이전. MariaDB 면 스키마 전면 번역 |
| 데이터 접근 | 전부 supabase-js(PostgREST) 쿼리 빌더 — 63개 파일, `.from()` 약 190곳, `.rpc()` 1곳 | Supabase 셀프호스팅이면 무변경. 순수 PG/MariaDB 면 전면 재작성 |
| 권한 | RLS 정책 43개, `auth.uid()` 26곳. 사용자 세션 클라이언트(`getServerSupabase`)로 조회하는 서버 코드 34개 파일 → **RLS 가 실제 권한 경계** | RLS 없는 DB(MariaDB)로 가면 모든 권한 검사를 앱으로 옮겨야 함(보안 회귀 위험 최대) |
| 인증 | 이메일/비밀번호만(소셜 로그인 없음), `auth.getUser` 27곳, 관리자 = `app_metadata.role='admin'`, 미들웨어 세션 갱신(`@supabase/ssr`) | 셀프호스팅 Auth(GoTrue)로 그대로. 비밀번호 해시는 `auth.users` 와 함께 이전 |
| 파일 | 버킷 `photos`(비공개 — 024)·`previews`(비공개, 인쇄 파일 — 017)·`marketing`(공개 — 018, 프레임 이미지 포함 — 026). 업로드·서명 URL·공개 URL | 파일은 DB 덤프와 **별도로** 복사해야 함(§5.2) |
| URL 저장 | 공개 URL(`https://acxsxjmqgvkceqahwkpz.supabase.co/storage/...`)이 **DB 컬럼에 그대로 저장** — `cart_items.photo_url`·`order_items.photo_url/print_file_url`·`landing_sections.image_url`·`product_images.image_url`·`frame_assets.preview_url`·`photos.thumb_url`·`stock_photos` 등, jsonb 안에도 있을 수 있음 | 2단계에서 **일괄 치환 필수**(§5.2-④) |

### Vercel

| 기능 | 실측 | 독립 서버에서 |
|---|---|---|
| 런타임 | Next.js 16.2.6, Vercel 은 Node 22.x 로 빌드 (`engines: 20.x \|\| 22.x`) | `next start` 로 실행. Node 22 LTS 사용 |
| 크론 | `vercel.json` — `/api/cron/render-retry`(01:00 UTC), `/api/cron/payment-sweep`(18:00 UTC), `CRON_SECRET` Bearer 인증 | 서버 cron 으로 대체(§4.2) |
| `after()` | `/payment/success` 서버측 결제 확정에서 사용 | `next start` 에서 완전 지원. 종료 시 SIGTERM 후 대기 필요 |
| 캐시 | `unstable_cache` 29곳, `revalidatePath` 57곳, `updateTag`/`revalidateTag`, ISR | 단일 인스턴스 + 영구 디스크면 자동 동작. **다중 인스턴스는 별도 설계 필요**(§4.1) |
| 이미지 최적화 | `next/image`, AVIF/WebP, `sharp` 의존 | `next start` 에서 무설정 동작(sharp 메모리 주의) |
| 스트리밍 | `/payment/success/loading.tsx` 가 확인 중 UI 를 스트리밍 | 리버스 프록시 버퍼링 끄기 필수 |
| 클라이언트 IP | `src/lib/security/client-ip.ts` 가 `x-real-ip` → `x-forwarded-for` 우측 값을 신뢰(Vercel 동작 전제) | **프록시가 이 헤더를 반드시 덮어써야 함** — 아니면 레이트리밋 우회 가능 |

### 선택지 비교 (결론: A)

| 안 | 구성 | 코드 변경 | 규모 |
|---|---|---|---|
| **A** | Supabase 셀프호스팅(Docker) + Next.js | 환경변수·도메인·하드코딩 4곳·DB URL 치환 | 리허설 포함 수주 |
| B | 순수 PostgreSQL + 앱 재작성(ORM·인증 라이브러리·S3 호환 저장소) | 데이터 계층 63개 파일 재작성, RLS → 앱 권한 검사 | 수개월 |
| C | MariaDB | B + 스키마 번역(jsonb·uuid·timestamptz·pg_trgm 검색·plpgsql 함수) | B 이상 |

---

## 2. 목표 구성

```
[1단계]  사용자 ─HTTPS→ Nginx ─→ Next.js(next start, systemd) ─→ Supabase 클라우드(서울)
                         └ cron → /api/cron/*                    (DB·Auth·Storage 그대로)

[2단계]  사용자 ─HTTPS→ Nginx ─┬→ Next.js
                               └→ Supabase API 게이트웨이(도커: Auth·PostgREST·Storage·Postgres …)
```

- 1·2단계를 같은 서버에 둘 수도, 앱/DB 서버를 나눌 수도 있다. 1인 운영이면 **단일 서버로 시작**하고
  사진·인쇄 파일 증가에 맞춰 디스크를 늘리는 쪽이 단순하다.
- **사양**(2단계 기준): Supabase 공식 최소 RAM 4GB·2코어·SSD 40GB, 권장 8GB+·4코어+·80GB+.
  여기에 Next.js 실행·빌드 몫을 더한다. 출발점 제안: **RAM 16GB · 4~8코어 · SSD 200GB+(데이터 볼륨 분리)**
  — 실측 후 조정. 1단계만 할 때는 RAM 4GB·2코어로 시작 가능(빌드는 CI 나 로컬에서 해 산출물만 배포하면 더 작게).

---

## 3. 0단계 — 준비 (양 단계 공통)

1. **도메인 확보**: 현재 운영 주소는 `frameshop-snowy.vercel.app` 로, 독립 서버로 가져갈 수 없다.
   자체 도메인(예: `shop.<도메인>`, 2단계용 `api.<도메인>`)을 준비하고 DNS TTL 을 300초로 낮춰 둔다.
2. **서버 기본 보안**
   - SSH 키 로그인만 허용(비밀번호 로그인 끔), fail2ban
   - 방화벽: 22·80·443 만 개방. **Postgres 5432·Supabase Studio 는 외부 비공개**(SSH 터널로만 접속)
   - 자동 보안 업데이트(unattended-upgrades), 서비스 전용 비-root 사용자
   - 비밀값은 `/etc/frameshop/env`(권한 600) 한 곳에만. 저장소·로그에 남기지 않는다
3. **모니터링**: Sentry(이미 사용) 유지 + 외부 가동 감시(헬스체크 URL) + 디스크·메모리 경보
4. **기준선 확보**: 이전 시작 전 `main` 커밋, 마이그레이션 적용 상태(현재 001~042 적용, 043 대기),
   Vercel·Supabase 설정 화면을 기록해 둔다(롤백 기준점).

---

## 4. 1단계 — 앱 서버만 이전 (Supabase 클라우드 유지)

DB 가 그대로이므로 Vercel 과 새 서버가 **같은 DB 를 동시에 바라볼 수 있다** — 무중단 전환·즉시 롤백 가능.

### 4.1 코드·설정 변경 (1단계 PR 로 묶을 것)

| # | 대상 | 이유 |
|---|---|---|
| 1 | 빌드 시 `NEXT_PUBLIC_SITE_URL` = 새 도메인 origin | `src/lib/security/same-origin.ts` 가 요청 Origin 을 이 값과 비교한다. **틀리면 장바구니·주문·업로드 등 변경 API 가 전부 403**. 클라이언트 env 는 빌드 시 인라인되므로 값 변경 = 재빌드 |
| 2 | `src/app/sitemap.ts`·`src/app/robots.ts` | 폴백이 stale 별칭 `https://frameshop.vercel.app` — env 를 반드시 주입하거나 폴백 수정 |
| 3 | 단일 인스턴스로 운영 | ISR·`unstable_cache` 는 인스턴스 로컬 디스크 캐시. 여러 대로 늘릴 때는 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 고정·공유 캐시 핸들러·`deploymentId` 가 필요(Next.js 셀프호스팅 문서 "Multi-Server Deployments") |
| 4 | (선택) `next.config.ts` 에 `output: 'standalone'` | Docker 이미지·배포 산출물 축소. `next start` 로 갈 거면 불필요 |
| 5 | `src/lib/legal/company.ts` | 호스팅 사업자(현재 `Vercel Inc.`)·국외 이전 고지 갱신(§7) |
| 6 | 전환 후 `vercel.json` 크론 제거 또는 Vercel 프로젝트 일시정지 | 양쪽 크론 중복 실행 방지(둘 다 멱등이지만 혼선 방지) |

### 4.2 서버 구성

**런타임**: Node 22 LTS + pnpm(레포 기준 lockfile `pnpm-lock.yaml`). 빌드 `pnpm install --frozen-lockfile && pnpm build`.

**환경변수**(`/etc/frameshop/env`, 이름만 — 값은 기존 Vercel 프로덕션 값과 동일하게):
`NEXT_PUBLIC_SUPABASE_URL` `NEXT_PUBLIC_SUPABASE_ANON_KEY` `SUPABASE_SERVICE_ROLE_KEY`
`NEXT_PUBLIC_SITE_URL` `NEXT_PUBLIC_TOSS_CLIENT_KEY` `TOSS_SECRET_KEY` `TOSS_WEBHOOK_SECRET`
`CRON_SECRET` `RESEND_API_KEY` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET`
`UPSTASH_REDIS_REST_URL` `UPSTASH_REDIS_REST_TOKEN`(선택) · Sentry(`NEXT_PUBLIC_SENTRY_DSN` 등, **빌드 시점** 값)
— Toss 키는 어드민 설정(DB)에서도 읽으므로 env 는 placeholder 여도 된다(현행과 동일).

**systemd 서비스**(예시):
```ini
# /etc/systemd/system/frameshop.service
[Unit]
Description=FrameShop (Next.js)
After=network.target

[Service]
User=frameshop
WorkingDirectory=/srv/frameshop/current
EnvironmentFile=/etc/frameshop/env
Environment=NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1
# pnpm 경로는 설치 방식(corepack 등)에 따라 다름 — `which pnpm` 로 확인
ExecStart=/usr/bin/pnpm start
Restart=always
# after() 작업(결제 확정 등)이 끝나도록 종료 대기 — Next.js 문서 권장 10~30초
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

**Nginx**(예시 — 핵심 4줄에 주석):
```nginx
server {
    listen 443 ssl http2;
    server_name shop.example.com;            # 실제 도메인
    # ssl_certificate … (certbot 자동 갱신)

    client_max_body_size 55m;                # 사진 업로드 상한 MAX_UPLOAD_BYTES=50MB + 여유

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;              # client-ip.ts 가 신뢰하는 헤더 — 반드시 덮어쓴다
        proxy_set_header X-Forwarded-For $remote_addr;        # 클라이언트가 보낸 값 이어붙이기 금지(위조 방지)
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;                                   # /payment/success 스트리밍(확인 중 UI)
        proxy_read_timeout 60s;
    }
}
server { listen 80; server_name shop.example.com; return 301 https://$host$request_uri; }
```

**크론**(서버 시간대 UTC 가정 — `timedatectl` 로 확인):
```cron
# /etc/cron.d/frameshop  (CRON_SECRET 은 env 파일에서 읽는 래퍼 스크립트로 호출 권장)
0 1 * * *     frameshop /srv/frameshop/bin/cron-call render-retry
0 18 * * *    frameshop /srv/frameshop/bin/cron-call payment-sweep
```
```sh
#!/bin/sh
# /srv/frameshop/bin/cron-call — Bearer 인증으로 로컬 Next.js 크론 라우트 호출
set -eu
. /etc/frameshop/env
curl -fsS -m 70 -H "Authorization: Bearer ${CRON_SECRET}" "http://127.0.0.1:3000/api/cron/$1" > /dev/null
```
- 하루 1회 제약이 없어지므로 `payment-sweep` 을 더 자주 돌릴 수 있다. 단 인증만 끝난(IN_PROGRESS)
  결제를 10분 승인 창 안에 구하려면 `src/lib/payment/sweep.ts` 의 `SWEEP_MIN_AGE_MS`(현재 15분)도
  함께 낮춰야 한다(코드 변경 — 별도 PR).

**이미지 최적화 메모리**: glibc 리눅스에서 sharp 메모리 증가 이슈가 알려져 있다(Next.js 셀프호스팅
문서가 sharp 의 "Linux memory allocator" 안내를 링크). 메모리 경보로 관찰하고 필요하면 해당 안내대로 조치.

### 4.3 외부 서비스 설정 갱신 (전환 직전)

| 서비스 | 항목 |
|---|---|
| Supabase Auth | URL 설정의 Site URL·Redirect URLs 에 새 도메인 추가(현재 `https://frameshop-snowy.vercel.app`) |
| Toss 개발자센터 | 웹훅 URL → `https://<새 도메인>/api/webhook/payment`. successUrl/failUrl 은 `window.location.origin` 기반이라 코드 변경 없음 |
| Google Cloud(구글 포토 연동) | OAuth 리디렉션 URI → `https://<새 도메인>/api/auth/google/callback` |
| Resend | 발신 도메인 인증(SPF/DKIM)은 도메인 기준 — 새 도메인 사용 시 재인증 |
| Sentry | 허용 도메인/릴리스 설정 확인 |

### 4.4 검증 (스테이징 도메인에서 전부 통과해야 전환)

- [ ] 홈·카탈로그·상품 상세 200, 이미지 최적화(`/_next/image`) 정상
- [ ] 로그인/로그아웃, `/admin` 관리자 게이트(비관리자 차단)
- [ ] 사진 업로드(대용량 30MB 이상 포함) → 편집기 → 장바구니 → 체크아웃 화면(POST 403 없음 = SITE_URL 정상)
- [ ] 비회원 쿠키(`fs-guest-sid`) 발급, 주문 조회
- [ ] `/payment/success` 잘못된 파라미터 → "결제 정보가 올바르지 않습니다" 화면(서버측 확정 경로 동작)
- [ ] 크론 2개를 수동 호출해 200, 인증 없으면 401
- [ ] 웹훅 엔드포인트: 깨진 JSON 400 · 미구독 이벤트 200
- [ ] 레이트리밋 키가 실제 클라이언트 IP 인지 로그로 확인(프록시 IP 로 찍히면 Nginx 설정 오류)
- [ ] Toss 테스트 키로 결제 1건 완주 → PAID, 쿠폰 소비, 웹훅 수신 기록
- [ ] `systemctl restart` 중 결제 확정이 끊기지 않음(SIGTERM 대기)

### 4.5 전환·롤백

- **전환**: DNS A 레코드를 새 서버로 → 외부 설정(§4.3) 갱신 → §4.4 핵심 항목 재확인 → Vercel 크론 중지.
- **롤백**: DB 가 공용이므로 **데이터 정리 없이** 되돌릴 수 있다 — Vercel 배포를 살려둔 상태에서
  DNS 를 되돌리고 외부 설정을 원복. 1단계 안정화(최소 1~2주)까지 Vercel 프로젝트를 삭제하지 않는다.

---

## 5. 2단계 — Supabase 셀프호스팅으로 데이터 이전

### 5.1 구성

- 공식 Docker Compose 구성을 사용한다(Studio·API 게이트웨이·Auth·PostgREST·Realtime·Storage·
  imgproxy·postgres-meta·Postgres·Supavisor 등). **예시 비밀값으로 절대 기동하지 않는다** —
  JWT secret·anon/service 키·DB 비밀번호·대시보드 비밀번호를 새로 생성.
- 공개는 API 게이트웨이(`https://api.<도메인>`)만, 앞단 Nginx 에서 TLS 종료. Studio·Postgres 비공개.
- 인증 메일(비밀번호 재설정 등)용 SMTP 설정(Resend SMTP 등).
- 이미지 버전은 운영 클라우드와 같거나 더 새 것으로 맞춘다 — `auth`·`storage` 스키마 버전 차이로
  복원이 실패할 수 있으며, 리허설에서 잡는다.

### 5.2 리허설 절차 (스테이징에서 최소 2회)

**① DB 덤프** — Supabase 공식 "Backup and Restore using the CLI"(2026-11-03 확인. CLI 버전별 플래그 확인):
```bash
supabase db dump --remote="$OLD_DB_URL" -f roles.sql --role-only
supabase db dump --remote="$OLD_DB_URL" -f schema.sql
supabase db dump --remote="$OLD_DB_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

**② 복원**:
```bash
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$NEW_DB_URL"
```
- 공식 문서: `auth`·`storage` 에 직접 만든 트리거·RLS 등 커스터마이징은 별도로 복원해야 하고,
  LOGIN 속성의 커스텀 롤은 비밀번호를 수동 설정해야 한다.
- 데이터 덤프는 `auth` 스키마를 제외하지 않으므로 `auth.users`(비밀번호 해시 포함)가 함께 옮겨진다 —
  **리허설에서 기존 계정 로그인으로 반드시 확인**한다.
- JWT secret 이 바뀌므로 기존 로그인 세션은 무효 → 전환 공지에 "재로그인 필요"를 포함한다.

**③ 파일(Storage) 복사** — DB 덤프에는 파일 본체가 없다. 공식 문서 "Migrating storage objects" 의
스크립트(구 프로젝트에서 내려받아 새 프로젝트로 업로드) 방식으로 버킷 전체를 복사하고, 버킷별 객체 수를
양쪽에서 비교한다. 코드가 쓰는 버킷은 `photos`·`previews`·`marketing` 이며, 실제 목록은 구 DB 의
`storage.buckets` 로 확인해 빠짐없이 옮긴다.

**④ DB 에 저장된 URL 치환** — 먼저 어디에 몇 건 있는지 찾는다(읽기 전용):
```sql
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text LIKE %L',
                   r.table_name, r.column_name, '%acxsxjmqgvkceqahwkpz.supabase.co%') INTO n;
    IF n > 0 THEN RAISE NOTICE '%.% : %', r.table_name, r.column_name, n; END IF;
  END LOOP;
END $$;
```
찾은 (테이블, 컬럼)마다 한 트랜잭션에서 치환한다(OLD/NEW 는 `https://` 포함 origin):
```sql
-- text/varchar 컬럼
UPDATE public.<table> SET <col> = replace(<col>, '<OLD_ORIGIN>', '<NEW_ORIGIN>')
WHERE <col> LIKE '%' || '<OLD_ORIGIN>' || '%';
-- jsonb 컬럼
UPDATE public.<table> SET <col> = replace(<col>::text, '<OLD_ORIGIN>', '<NEW_ORIGIN>')::jsonb
WHERE <col>::text LIKE '%' || '<OLD_ORIGIN>' || '%';
```
치환 후 위 탐색 쿼리를 다시 돌려 0건인지 확인한다. 인쇄 파일 ZIP(`/api/admin/orders/[id]/zip`)은
env 의 Supabase origin 과 일치하는 URL 만 받으므로 이 치환이 빠지면 ZIP 이 전부 SKIP 된다.

**⑤ 코드의 하드코딩 도메인 제거**(2단계 PR — env 에서 파생하도록):

| 위치 | 현재 | 빠지면 |
|---|---|---|
| `src/lib/render/pipeline.ts` (~289·310행) | 인쇄 렌더 fetch 허용 = `*.supabase.co` | **인쇄 파일 생성 전부 실패** |
| `src/data/landing-curation.ts:7` | 랜딩 이미지 URL 고정 | 랜딩 이미지 깨짐 |
| `src/app/layout.tsx:97-98` | preconnect/dns-prefetch 고정 | 성능 저하(기능 무관) |
| `next.config.ts:28` | env 없을 때 폴백 호스트 | 빌드 시 env 누락하면 이미지·CSP 차단 |

CSP(`img-src`·`connect-src`)와 `images.remotePatterns` 는 `NEXT_PUBLIC_SUPABASE_URL` 에서 파생되므로
env 만 바꾸면 따라온다. 경로 `/storage/v1/object/**` 는 셀프호스팅 게이트웨이에서도 동일한지 확인.

**⑥ 앱 재빌드**: `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` 는 빌드 시 인라인되므로
새 값으로 **재빌드**, `SUPABASE_SERVICE_ROLE_KEY` 교체.

### 5.3 검증 (리허설마다)

- [ ] 테이블별 행 수 구↔신 일치(주문·주문상품·회원 프로필·적립금 원장·쿠폰 사용 원장은 필수)
- [ ] 마이그레이션 산출물 일치: 함수 6개·트리거·RLS 정책 수·`storage.buckets`
- [ ] 기존 계정으로 로그인(비밀번호 그대로), 관리자 권한 유지
- [ ] 사진 업로드·썸네일·서명 URL(비공개 버킷) 열람, 랜딩·상품 이미지 표시
- [ ] 인쇄 렌더 1건 생성 + 관리자 주문 ZIP 다운로드(SKIP 없음)
- [ ] 적립금 사용·쿠폰 적용 주문 → Toss 테스트 결제 → PAID → 웹훅 → 감사 기록
- [ ] 탐색 쿼리로 `supabase.co` 잔존 0건
- [ ] **백업 복원 리허설**: 새 서버 백업으로 별도 DB 를 복원해 위 항목 일부 재확인

### 5.4 컷오버 런북

| 시점 | 작업 |
|---|---|
| T-7일 | 리허설 2회 통과 · 점검 공지(일시·예상 소요·재로그인 안내) · DNS TTL 300초 |
| T-1일 | 최신 덤프로 최종 리허설(소요 시간 실측) · 롤백 담당·기준 확정 |
| T-0 시작 | 트래픽 적은 시간대. 최근 30분 내 CREATED 주문 없음 확인(결제 진행 중 고객 보호) |
| T+0 | Nginx 점검 페이지(503) 전환 — Toss 웹훅도 503 을 받아 나중에 재전송된다 |
| T+5분 | 최종 덤프 → 복원 → 파일 최종 동기화 → URL 치환 → 탐색 0건 확인 |
| T+?분 | 새 env 로 빌드·기동 → 운영자 hosts 파일로 내부 스모크(§5.3 핵심) |
| 오픈 | 점검 해제 → 외부 스모크 → Toss 웹훅 재전송 수신 확인 |
| T+1~7일 | 매일 행 수·오류율·디스크 확인. 구 Supabase 프로젝트는 **쓰기 중지 상태로 보관** |

### 5.5 롤백과 되돌릴 수 없는 지점

- **오픈 전**: 점검 해제 없이 env 를 구 Supabase 로 되돌려 재빌드·기동 → 데이터 손실 없음.
- **오픈 후**: 새 DB 에 주문이 쌓이기 시작하면 단순 롤백은 그 주문을 잃는다. 롤백 결정은
  **오픈 후 몇 시간 안**에 하고, 그 사이 생긴 주문·결제는 Toss 대시보드 기준으로 수동 이관한다.
  그 시간을 넘기면 "앞으로 고치기"로 대응한다.
- 구 Supabase 프로젝트는 안정화(최소 2주) 확인 전까지 삭제·다운그레이드하지 않는다.

---

## 6. 운영 (이전 후 상시)

| 항목 | 기준 |
|---|---|
| DB 백업 | 매일 `pg_dump -Fc` → **서버 밖** 저장소, 보존(예: 일 7·주 4). 주문 증가 시 WAL 기반 PITR(pgBackRest·WAL-G 등) 검토 — 일일 덤프만이면 최대 24시간 데이터 손실 가능 |
| 파일 백업 | 버킷 디렉터리/객체 저장소를 서버 밖으로 일일 동기화 |
| 복원 리허설 | 월 1회 — 백업이 실제로 복원되는지가 백업의 전부다 |
| 업데이트 | OS 보안 패치 자동 · Supabase 이미지(대략 월 단위 릴리스)·Next.js 는 스테이징 먼저 |
| 감시 | Sentry 오류율 · 가동 감시 · 디스크 80% 경보(인쇄 파일 `previews` 증가 주의) · 인증서 만료 |
| 접근 | Studio·DB 는 SSH 터널로만. 관리자 계정·서버 키 회전 주기 기록 |

---

## 7. 법·고지 갱신

- `src/lib/legal/company.ts` 의 처리 위탁·국외 이전 항목: 현재 `Vercel Inc.(국외: 미국)`·
  `Supabase Inc.(국외 법인, 데이터 리전: 서울)`. 국내 호스팅으로 옮기면 해당 사업자로 바꾸고 국외 이전
  고지를 정리한다. 개인정보처리방침 개정 시행일 고지 필요 여부는 법률 검토.
- 호스팅 사업자 표기(전자상거래법 사업자 정보)도 함께 갱신.

---

## 8. CTO 결정 대기

1. **런칭 호스팅**: Vercel Pro 로 런칭 후 천천히 이전 vs 1단계 완료 후 런칭
2. **서버**: 호스팅 업체·사양·단일 서버 vs 앱/DB 분리
3. **도메인**: 운영 도메인 확정(1단계 선행 조건)
4. **2단계 시점**: 런칭 전(데이터 거의 없음, 위험 최소) vs 런칭 후(운영 데이터 이전·점검 필요)
5. **백업 수준**: 일일 덤프 vs PITR(허용 가능한 데이터 손실 시간)

---

## 9. 출처 (2026-11-03 확인)

- Vercel Fair Use Guidelines — Hobby 상업 이용 제한: https://vercel.com/docs/limits/fair-use-guidelines
- Vercel Cron 사용량·Hobby 일 1회: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Next.js 셀프호스팅(레포 내 `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md`, v16.2.6) —
  리버스 프록시·이미지 최적화·캐시/ISR·다중 서버·스트리밍 버퍼링·`after` 종료 대기
- Supabase 셀프호스팅(Docker): https://supabase.com/docs/guides/self-hosting/docker
- Supabase 백업·복원(CLI)·Storage 이전: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
