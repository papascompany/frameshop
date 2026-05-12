# FrameShop Supabase 세팅 가이드

> **프로젝트**: `https://acxsxjmqgvkceqahwkpz.supabase.co`
> **Phase 1 MVP 동작을 위한 최소 세팅**

---

## ⚠️ 사전 확인 — CLI 권한 이슈

현재 워크스테이션에 로그인된 Supabase CLI 계정은 다음 두 organization에만 접근 가능합니다:
- `papascompany` (rpgjrckrcrxhrbrimjbv)
- `thestorige@gmail.com` (wwbrybixwrhdghhqvgpq)

`acxsxjmqgvkceqahwkpz` 프로젝트가 두 org에 보이지 않으므로, **셋 중 하나를 선택**해 진행해주세요:

### 옵션 A — CLI 권한 다시 받기 (재로그인)
1. Supabase Dashboard 우측 상단 프로필 → **Account** → **Access Tokens** → **Generate new token**
2. 토큰 이름: `frameshop-cli`, 만료: 적당히 (90일 등)
3. 생성된 토큰 복사
4. 터미널에서:
   ```bash
   export SUPABASE_ACCESS_TOKEN=<paste-token-here>
   supabase link --project-ref acxsxjmqgvkceqahwkpz
   supabase db push
   ```
5. 이후 마이그레이션이 자동 적용됩니다.

### 옵션 B — Dashboard SQL Editor 수동 실행 (가장 단순)
1. https://supabase.com/dashboard/project/acxsxjmqgvkceqahwkpz/sql/new
2. 아래 파일들을 **순서대로** 복사 → 붙여넣기 → **Run**:
   - `docs/setup/00-combined-migrations.sql` (12개 마이그레이션 통합, 546줄)
   - `docs/setup/01-storage-buckets.sql` (photos / previews 버킷)
   - `docs/setup/02-seed-data.sql` (카테고리 1 + 상품 1 + variants 4)
3. 각 실행 후 에러 없는지 확인.

### 옵션 C — psql 직접 연결
1. Dashboard → **Settings** → **Database** → **Connection string** → URI 복사 (password 포함)
2. 터미널:
   ```bash
   psql "<URI>" -f docs/setup/00-combined-migrations.sql
   psql "<URI>" -f docs/setup/01-storage-buckets.sql
   psql "<URI>" -f docs/setup/02-seed-data.sql
   ```

---

## 🔑 API 키 가져오기 (필수)

위 SQL 실행 후, Dashboard에서 키를 복사해 `.env.local`에 채워주세요.

### 키 위치
**Dashboard → Settings → API**

1. **`Project URL`** → `NEXT_PUBLIC_SUPABASE_URL` (이미 채워져 있음)
2. **`Project API keys` → `anon` `public`** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. **`Project API keys` → `service_role` `secret`** → `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ 절대 클라이언트로 노출 금지 (`src/lib/env.ts`에 `server-only` 가드 적용됨)

`.env.local` 최종 모습:
```
NEXT_PUBLIC_SUPABASE_URL=https://acxsxjmqgvkceqahwkpz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
```

---

## 💳 토스페이먼츠 키 가져오기

1. https://developers.tosspayments.com → 로그인 → **내 개발 정보**
2. **테스트 키**의 클라이언트/시크릿 키 복사
3. 별도 **웹훅 시크릿**도 발급 (Webhook 메뉴)
4. `.env.local`에 채우기:
   ```
   NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_...
   TOSS_SECRET_KEY=test_sk_...
   TOSS_WEBHOOK_SECRET=...
   ```

---

## 🖼️ Storage 파일 업로드 (선택, 카탈로그 이미지 보려면 필요)

`02-seed-data.sql`의 시드 데이터는 카테고리/상품/variants까지만 만들고 **이미지 레코드는 비어있음**(주석 처리됨). 카탈로그 페이지에서 실제 이미지를 보려면:

1. **Dashboard → Storage → photos** 버킷
2. 다음 파일들 업로드:
   - `product-thumb-basic.jpg` (300×300, 카드 썸네일)
   - `product-gallery-basic.jpg` (1200×1200, 상세)
   - `frame-black.png` (1200×1500, 가운데 투명, 액자 오버레이)
   - `frame-black-preview.jpg` (200×200, 색상 스와치)
3. `docs/setup/02-seed-data.sql`의 주석 처리된 `product_images` / `frame_assets` insert 블록을 풀고 SQL Editor에서 실행.

> ⚠️ 이미지 없이도 페이지는 동작하지만, 카드는 회색 placeholder로 보입니다.

---

## 👤 Admin 사용자 만들기 (선택, `/admin` 페이지 접근하려면 필요)

1. Dashboard → **Authentication → Users → Add user**로 본인 계정 생성 (예: `yohan@papascompany.co.kr`)
2. SQL Editor에서:
   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
   where email = 'yohan@papascompany.co.kr';
   ```
3. 사용자 메뉴에서 로그아웃 → 로그인 (JWT 재발급)
4. `/admin/products`, `/admin/orders`, `/admin/shipping` 접근 가능

---

## ✅ Dev 검증

위 단계 완료 후:

```bash
npm run dev
```

브라우저에서 http://localhost:3000 열고 **모바일 viewport (375px)** 로 다음 핵심 플로우 클릭 테스트:

| 단계 | URL | 확인 |
|---|---|---|
| 1. 랜딩 | `/` | 카테고리 그리드에 "베이직 액자" 카드 노출 |
| 2. 카탈로그 | `/catalog/basic-frame` | 베이직 액자 카드 (썸네일 + 4,800원~) |
| 3. 상품 상세 | `/product/00000000-0000-0000-0000-000000000010` | 설명/제작가이드/"주문하기" 버튼 |
| 4. 편집기 | `/studio/<orderId>` | 사진 업로드 → Konva 캔버스 → 사이즈/색상 변경 |
| 5. 카트 | `/cart` | 담은 아이템 노출, 수량 변경 |
| 6. 체크아웃 | `/checkout` | 배송 방법 3종 + 임계값 무료 표시 확인 |
| 7. 결제 | (Toss SDK 팝업) | test 카드 번호 (4242 4242 4242 4242) 사용 |
| 8. 완료 | `/order/success` | 주문번호 노출 |

---

## 🐛 알려진 디버깅 포인트

- **이미지 깨짐**: `next.config.ts`의 `images.remotePatterns` hostname이 실제 프로젝트 ref와 일치하는지 확인 (현재 `*.supabase.co` 와일드카드라 자동 매칭)
- **/admin 403**: `app_metadata.role !== 'admin'`. SQL update 후 반드시 재로그인.
- **편집기 빈 화면**: `frame_assets` 테이블에 행이 없으면 `lookupVariant` 실패. 위 5번 단계 (Storage + frame_assets insert) 완료 필요.
- **`uploadRatelimit`**: 분당 10건 제한. 테스트 중 자주 업로드하면 429. 60초 대기 또는 dev 모드에서만 `UPLOAD_RATE_PER_MIN` 임시 상향 (단, prod 코드는 그대로).
