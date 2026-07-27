# 새 세션 시작 프롬프트 (복사해서 새 Claude Code 세션 첫 메시지로 붙여넣기)

> 최종 갱신: 2026-07-21. 이 블록 전체를 새 세션에 붙여넣으면 맥락을 이어 작업할 수 있다.

---

당신은 FrameShop(Next.js 16 App Router + Supabase + Toss Payments, 맞춤형 액자/사진 인쇄 이커머스)의 엔지니어로서 CTO(yohan)의 작업을 이어서 진행합니다. **한국어 경어(존댓말) 필수.** 작업 방식은 서브에이전트 오케스트레이션(하네스: 정찰→Review Gate→Foundation→병렬 배치→적대 리뷰(Security∥Final)→수정→문서→PR/머지/배포→마이그 적용→런타임 검증). 동시 병렬 상한 3, 파일 소유권 disjoint.

## 0. 가장 먼저 — 즉시 할 일 (미완 1건)
**마이그레이션 036/037/040/041/042 프로덕션 적용이 유일한 미완.** 코드·리뷰·배포는 전부 끝났고(main `cea4432` 배포 READY), 이 5본만 적용하면 P2/P3·쿠폰·문의·위시가 런타임 활성화된다. 미적용 상태에서도 feature-probe 게이트로 **앱은 완전 정상**(신규 기능 UI만 숨김).
- **제약**: FrameShop DB는 `yohan73@gmail.com` 계정. Claude의 Supabase MCP/CLI는 papascompany 계정이라 접근 불가 → **CTO가 브라우저(claude-in-chrome)에서 yohan73로 Supabase 로그인**해야 Claude가 SQL Editor에서 적용 가능(로그인=Claude 대행 불가). 세션이 자주 만료되니 로그인 직후 바로 진행.
- **통합 SQL 이미 작성됨**: 각 파일 `supabase/migrations/036·037·040·041·042.sql`. 순서 **036→042**(036이 034 cart_projects에 FK를 건다). 전부 비파괴·멱등.
- **가이드**: `docs/MIGRATIONS-APPLY.md` "★ 2차 적용 대기" 절 — 5본 표·검증 쿼리·롤백 SQL 완비.
- **적용 후 런타임 검증**: probe TTL 60초 후 → 체크아웃 쿠폰 카드 노출, `/account/wishlist`·`/account/inquiries` 동작, `/admin/coupons`·`/admin/inquiries` 조회, admin 상품 워크스페이스(extended) 세트/규칙 탭. 검증 쿼리(테이블 5·orders coupon 2컬럼·cart_projects FK).

## 1. 먼저 읽을 것 (순서대로)
1. `shared/HANDOFF.md` 말미 — 웨이브별 인계(EC/P1/FS-X). **다음 세션이 이것만 읽고 이어받도록 작성됨.**
2. `docs/BACKLOG.md` — 남은 작업 SSOT. §1(마이그 적용 현황)·§1A(확장형 P0~P3 완료)·§5(Phase C 남은 항목).
3. `docs/MIGRATIONS-APPLY.md` — 마이그 적용 가이드(1차 완료 + 2차 대기).
4. `shared/DECISIONS.md` — ADR-020~026(특히 ADR-026=쿠폰/P2/P3 정책 + Postscript).
5. `docs/specs/extended-product.md` — 확장형 설계 SSOT(§5 어드민·§7 시각화·§8 롤아웃).
6. `AGENTS.md` — 커스텀 Next.js 16. **코드 작성 전 `node_modules/next/dist/docs` 관련 가이드 먼저 읽기.**
7. 자동 로드 프로젝트 메모리(project-*.md).

## 2. 정본 경로 / 배포 / 계정
- **정본 로컬**: `/Users/yohan/Developer/frameshop` (iCloud 밖). `~/Documents/frameshop`은 stale 사본이라 git 쓰기 멈춤 — 사용 금지(메모리 project-icloud-git-stall).
- **프로덕션**: https://frameshop-snowy.vercel.app (icn1/서울). `frameshop.vercel.app`은 stale 별칭.
- **현재 HEAD**: main `cea4432`, origin 동기, 배포 READY. git author = `PapasCompany`(68457172+papascompany@users.noreply.github.com) 여야 자동 배포(확인: `git config user.email`).
- **Supabase 프로젝트**: yohan73 계정 / project ref `acxsxjmqgvkceqahwkpz`(name=frameshop, Yohan73 Org). MCP는 papascompany라 미접근.
- **Vercel**: team `team_dOpgsAqfLyl4qNlVgSiFVm6B`, project `prj_sZpuZWqjUqPdxx8oChrQ2gTEi72n`.

## 3. 완료된 내역 (전부 라이브 — 코드/배포 기준, 마이그 2차 적용 대기 제외)
현황: **확장형 상품 P0~P3 + 이커머스 기본 + 커머스 확장(쿠폰/문의/위시) 전부 완성.** vitest 798 passed | 14 todo.

- **가로/세로·인쇄 photo-only·보안 Phase0·리전 icn1·주문관리 Phase A/B-1** (이전 세션들, #47~#56).
- **EC 웨이브(#59, ADR-024)**: 적립금(earn/redeem/자동회수)·부분환불(Toss cancelAmount)·현금영수증·제주도서산간 배송비·법적고지(/terms·/privacy·404·사업자정보)·체크아웃 동의 2종·admin 통계 대시보드·주문 ZIP·명화 썸네일·**포토월 시뮬레이터 /wall**.
- **확장형 P0(#58, ADR-023)**: product_type·cart_projects·`src/types/project.ts`·CartItem 묶음필드·카트 v2 마이그레이터·adminNav SSOT. graceful 비게이트.
- **확장형 P1 편집기(#61, ADR-025)**: `?mode=multi` 멀티포토 편집기(PhotoPoolPanel/LineList/묶음 담기)·kind 분기(베이직 회귀 0)·드래프트 v2·상품상세 "여러 장 만들기" CTA. CTO 케이스 1~4 커버.
- **FS-X 웨이브(#63, ADR-026)** — P2/P3/커머스 확장:
  - **P2**: `/admin/products/[id]` 워크스페이스 6탭(유형 게이트 single→extended 승격·Frames/Options embedded 임베드·bundle_rules 폼·set_templates 슬롯 빌더 mm폼+WallCanvas 미니맵). *세트할인 createOrder 적용은 보류(세트 SKU 출시 시).*
  - **P3**: 그룹핑 뷰모델(`groupCartByProject`/`groupOrderByGroupId`)·cart 묶음 카드+세트 원자 선택(부분선택 불가)·checkout/success/lookup/MyOrders/admin 그룹 표시+할인 분해·**reorder 세트 복원 버그 수정**.
  - **쿠폰(042)**: 정액/정률·최소금액·만료(KST)·전체한도(CAS 원자)·회원 1인1회. 서버 재검증·net totalPrice·**소비=결제 confirm 시점**(재시도 소실 방지)·취소 시 복원. `/admin/coupons` CRUD.
  - **1:1문의(040)**: account 작성/목록+admin 답변(이메일)+비밀글.
  - **위시리스트(041)**: 로그인 전용·하트 아일랜드(배치 하이드레이션)·카탈로그/상세/`/account/wishlist`.
- **마이그 1차 029~039 프로덕션 적용 완료**(2026-07-06, BL-010 Resolved). 검증 24행 일치, probe 런타임 활성화 확증.

## 4. 예정/남은 내역
- **[즉시] 마이그 2차 적용 036/037/040/041/042** — §0 참조(로그인 필요).
- **런칭 전 CTO 액션(코드 아닌 운영)**: ① Toss 실키 설정(쿠폰 소비=confirm 이동으로 **실결제 스모크 필요**) ② 제주/도서산간 surcharge 실요금 admin 설정(현재 0원) ③ 약관/방침 법률 자문 ④ `src/lib/legal/company.ts` placeholder 확정.
- **확장형 후속(P2 후기/P3+)**: 갤러리월 드래그 슬롯 에디터·세트 SKU 주문 플로우·**세트할인 createOrder 적용**(ADR-026 보류 해제 시 — 이때 P2-006 세트 원자성 **서버 강제**가 P0 선결과제, 현재는 sessionStorage 기반이라 세트가 무영향) · 재크롭 배지 드래프트 영속화 · extended 명화/Google Photos 소스 · 서버 드래프트(교차기기).
- **Phase C 남은 항목**: SMS/카카오 알림톡 · 회원정보 관리(수정/탈퇴) · 배송추적 API 연동 · 부분환불 적립 비례 조정(ADR-024 잔여) · 비회원 1:1문의(ADR-026 §11 — 현재 회원 전용).
- **보안 Phase 1/2**: 분산 레이트리밋 Upstash env 설정(코드 완료) · CSP 강화 등.

## 5. 반드시 지킬 제약 (실패 경험 반영)
- **이중 lockfile 함정**: Vercel은 `pnpm --frozen-lockfile`. 의존성 변경 시 `pnpm install --lockfile-only`로 pnpm-lock.yaml도 갱신 필수(#60 실사고). 커밋 전 `pnpm install --frozen-lockfile` exit 0 확인.
- **검증 게이트**: `rm -rf .next/types && npx tsc --noEmit` · `npx eslint src tests --max-warnings=0` · `npx vitest run`(베이스라인 798) · `npx next build`. 전부 GREEN 후 커밋.
- **적대 리뷰 필수**: 금전/이음새(seam) 변경은 Security∥Final 2팀 적대 리뷰. 직전 웨이브들의 P0가 전부 **FE↔BE route 이음새**에서 나왔다 — seam 전 구간 추적 + route 통합 테스트 필수.
- **FROZEN 타입**: 옵셔널 추가만, ADR 선승인. **graceful probe/conditional-spread**로 마이그 미적용에도 앱 정상 유지가 프로젝트 표준(ADR-023/024).
- **오케스트레이션**: 규모 작업은 Workflow 계층형(데이터→서버→UI). 워크플로 구조화 출력은 **간결 제약**(facts/plan 개수·길이 상한)을 걸어야 실패 안 함(FS-X 정찰서 2회 초과 실패 경험). 리뷰 서브에이전트는 `.md` 파일 못 씀 → 페이로드 텍스트로 반환.
- **워킹트리 잡파일**: `.claude/worktrees/`·`README 2.md`·`.claude/launch.json`은 untracked — 커밋에서 항상 제외(`git add`에 `:!` 사용).
- **마이그 직접 적용 불가**: §0·§2 — CTO 브라우저 로그인 후 SQL Editor.

## 6. 지금 할 일
CTO가 Supabase(yohan73)에 로그인돼 있으면 **즉시 마이그 036/037/040/041/042 적용 + 검증 + probe 런타임 확인**(§0). 로그인 안 돼 있으면 로그인 요청. 그 외 새 작업 지시가 있으면 위 §4에서 우선순위를 CTO와 확인 후 오케스트레이션으로 착수.
