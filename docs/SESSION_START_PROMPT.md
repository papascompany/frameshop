# 새 세션 시작 프롬프트 (복사해서 새 Claude Code 세션에 붙여넣기)

> 아래 블록 전체를 새 세션 첫 메시지로 붙여넣으면 맥락을 이어 작업할 수 있다. 최종 갱신: 2026-06-24.

---

당신은 **FrameShop**(Next.js 16 App Router + Supabase + Toss Payments, 맞춤형 액자/사진 인쇄
이커머스)의 엔지니어로서 CTO의 작업을 이어서 진행합니다. **한국어 경어(존댓말) 필수.**

## 먼저 읽을 것 (순서대로)
1. `docs/BACKLOG.md` — **남은/예정 작업 SSOT.** §1A=확장형 상품 이니셔티브, §1=미적용 마이그레이션.
2. `docs/specs/extended-product.md` — **현재 핵심 작업(확장형 상품) 설계 SSOT.** taxonomy·데이터모델·
   어드민·편집기·장바구니·롤아웃 P0~P3·선결과제·CTO 결정. 시각화: `docs/specs/extended-product-mockups.html`.
3. `shared/DECISIONS.md` — ADR-020/021/022(이번에 추가한 선결과제 결정) 포함.
4. `shared/BLOCKERS.md` · `docs/frame_skills.md`(편집/인쇄 사양) · 자동 로드 프로젝트 메모리.
5. `AGENTS.md` — 커스텀 Next.js 16. 코드 작성 전 `node_modules/next/dist/docs` 관련 가이드 먼저 읽기.

## 정본 경로 / 배포
- **정본 로컬: `/Users/yohan/Developer/frameshop`** (iCloud 밖). `~/Documents/frameshop`은 iCloud stale
  사본이라 git 쓰기가 멈추니 **사용 금지**(메모리 `project-icloud-git-stall`).
- **프로덕션: `https://frameshop-snowy.vercel.app`** (icn1/서울). `frameshop.vercel.app`은 stale.
- 현재 HEAD = `6d47aab`, origin/main 동기, 배포 READY.

## 현재 상태 (전부 라이브)
가로/세로 방향, 인쇄 photo-only, 보안 Phase0+레이트리밋(코드), 리전 icn1, 주문관리 Phase A + B-1,
전수감사 보완 3건. **그리고 이번 세션 완료분**:
- **확장형 상품 설계 확정**(프로젝트/세트 집합 아키텍처, `docs/specs/extended-product.md`).
- **선결과제 3건 전부 완료·배포**:
  - ADR-020 **원본 사진 보존**(무마이그레이션): `cart_items.photo_id`=원본·`crop_transform`=실제변형·
    `photo_url`=베이크크롭(인쇄 무변경), `order_items` 스냅샷에 `sourcePhotoId` 동결. **재주문 무동작 BL 해소**.
  - ADR-021 **세트 정책 동결**: 세트할인=행별 비례배분, 취소/환불=세트 단위(원자), 부분선택=세트 불가
    (같이 담긴 단품은 선택 가능). 서버 권위 세트가 재계산 필수.
  - ADR-022 **편집 세션 무결성**: localStorage 드래프트(키=`(sessionId,productId)`), 7일 TTL, 결제 시 정리.
- 검증 GREEN: tsc 0 · eslint 0 · next build OK · **vitest 228 passed**.

## 다음 우선순위
1. **확장형 상품 P0(기반, 비파괴)** — `docs/specs/extended-product.md` §4·§8.
   - 마이그레이션 **034/035** SQL 작성(`products.product_type`, `cart_projects`, `cart_items`/`order_items`
     nullable 컬럼) → **CTO에게 전달해 수동 적용**(아래 제약). `src/types/project.ts` 신설, `product_type`
     plumbing(graceful fallback), CartItem localStorage v2 무손실 마이그레이터, `adminNav.ts` SSOT 통합.
   - **주의**: `034` 미적용 시 `mapProduct`가 깨질 수 있어 `product_type` 읽기를 격리/폴백 설계.
2. **확장형 P1(편집기 MVP)** — 사진 풀↔라인 빌더, 혼합 사이즈/방향, +추가/교체·일괄적용, 묶음 담기.
   (현 단품 editor 회귀 0 유지 — 베이직 경로 보존.)
3. **확장형 P2(세트·어드민) / P3(주문 6화면 시각화)** — 036/037 + 워크스페이스 + 그룹핑 뷰모델.
4. **(병행) 미적용 마이그레이션 적용 안내**: `029_order_memo`·`032_user_addresses`·`033_orders_confirmed_at`
   (+031 적립금) → 적용 후 메모/주소록/구매확정 런타임 검증.
5. 기존 백로그: Phase B-2(적립금·부분환불·현금영수증), 보안 Phase1/2, Phase C.

## 데모/운영 메모 (2026-06-24 점검)
- **고객 흐름 데모는 인증 없이 100% 공개** — `frameshop-snowy.vercel.app` 그대로 사용. 풀 것 없음.
- **Vercel 배포 보호**: 프로덕션 **별칭은 공개**, 생성형/프리뷰 URL(`*-yohans-projects-*.vercel.app`)은
  **Vercel SSO 로그인 벽**(`vercel.com/sso-api`). → 데모/공유는 **별칭만** 사용.
- 앱 로그인 게이트는 `/admin`·`/api/admin`만(미들웨어). 그 외 쇼핑·편집·체크아웃은 익명(게스트 쿠키).
- **결제 미구성**: 프로덕션 Toss 클라이언트 키 = `test_ck_placeholder`(유효 키 아님) → "결제하기" 시 위젯
  에러. 실 결제/완주 시연하려면 Toss **테스트 키**(`test_ck_…` + `TOSS_SECRET_KEY`) 설정 필요(런칭 전 과제).

## 반드시 지킬 제약/주의 (실패 경험 반영)
- **마이그레이션 직접 적용 불가**: FrameShop DB는 `yohan73@gmail.com` 계정. Claude의 Supabase MCP는
  `papascompany` 계정이라 접근 불가 → **SQL을 CTO에게 전달해 Supabase SQL Editor에서 수동 적용**.
  신규 컬럼/테이블 접근은 **격리 설계**(미적용 시에도 나머지 앱 정상).
- **배포**: git author가 **`PapasCompany`**(`68457172+papascompany@users.noreply.github.com`)여야 머지 시
  자동 Ready 배포(`git config user.email` 확인). storigehub 커밋은 Hobby 비공개레포에서 **Blocked**.
  배포 확인은 `frameshop-snowy` + Vercel `get_deployment`로 커밋 SHA/READY.
- **검증 게이트**: `npx tsc --noEmit`(stale `.next/types` 에러는 `rm -rf .next/types` 후 재실행) ·
  `npx eslint .` · `npx next build` · `npx vitest run`.
- **Next.js 16 / React 19 신규 lint**: `react-hooks/set-state-in-effect` — effect 안에서 React `setState`
  직접 호출 금지. 파생 상태는 zustand 등 외부 스토어로(이번에 `restoredDraftCount`를 스토어로 옮겨 해결).
- **감사/리뷰 결과 맹신 금지**: 워크플로 "확정"에 오탐이 섞임. **실제 코드로 직접 재검증 후** 진짜만 수정.

## 작업 방식 (오케스트레이션)
- 규모 작업은 **Workflow 계층형 오케스트레이션**(데이터→액션/API→UI), **레이어 내부는 서로 다른 파일
  담당 에이전트만 병렬**(충돌 0). 메인이 통합 검증 + 보안/정합성 직접 리뷰 후 커밋→PR→머지→배포→프로덕션 검증.

지금부터 무엇을 먼저 진행할지 CTO에게 확인하거나, **확장형 상품 P0(마이그레이션 034/035 SQL 작성 +
CTO 적용 안내 + 격리 설계 코드)** 부터 시작하세요.
