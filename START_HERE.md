# FrameShop — Claude Code 시작 가이드

> 이 문서는 Papas가 Claude Code 터미널에서 복사-붙여넣기 해서 자율 개발을 시작하기 위한 매뉴얼입니다.

---

## ✅ Step 1. 프로젝트 폴더 만들기 (로컬에서 실행)

```bash
# 새 디렉토리 생성
mkdir frameshop && cd frameshop

# Next.js 15 + TypeScript + Tailwind 초기화
npx create-next-app@latest . \
  --typescript --tailwind --app --src-dir \
  --eslint --import-alias "@/*"

# Git 초기화
git init && git add -A && git commit -m "chore: init Next.js"
```

## ✅ Step 2. 에이전트 & 문서 파일 배치

이 ZIP의 모든 파일을 새 폴더에 풀어 넣으세요:

```
frameshop/
├── .claude/
│   └── agents/
│       ├── orchestrator.md
│       ├── planner.md
│       ├── architect.md
│       ├── designer.md
│       ├── backend-dev.md
│       ├── frontend-dev.md
│       ├── tester.md
│       └── qc-reviewer.md
├── docs/
│   └── PLAN.md                  ← FrameShop_개발계획서.md를 여기로
└── (Next.js 기본 파일들)
```

## ✅ Step 3. 환경 변수 준비

`.env.local` 파일 생성:

```env
# Supabase (https://supabase.com에서 발급)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Toss Payments (https://developers.tosspayments.com)
NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_...
TOSS_SECRET_KEY=test_sk_...

# Kakao Address API (https://postcode.map.daum.net)
# (스크립트 로드만 하므로 키 불필요, Phase 2에서)

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## ✅ Step 4. 필수 의존성 설치

```bash
# 코어
npm install @supabase/supabase-js @supabase/ssr zustand zod \
  react-hook-form @hookform/resolvers \
  konva react-konva react-konva-utils \
  sharp \
  @tosspayments/payment-sdk

# UI
npx shadcn@latest init    # 기본 토큰 설정
npx shadcn@latest add button input select dialog tabs card toast

# 한국어 폰트
# Pretendard는 CDN 또는 self-hosted. 둘 다 OK.
# https://github.com/orioncactus/pretendard

# 개발 도구
npm install -D vitest @vitejs/plugin-react @testing-library/react \
  @testing-library/jest-dom @testing-library/user-event \
  msw @playwright/test \
  @types/node

# Playwright 브라우저 다운로드
npx playwright install --with-deps chromium webkit
```

## ✅ Step 5. Claude Code 세션 시작

터미널에서:

```bash
claude
```

## ✅ Step 6. 오토파일럿 시작 명령 (복사-붙여넣기)

세션 안에서 첫 명령으로 아래를 입력하세요:

```
오케스트레이터에게 작업을 위임한다.

작업: FrameShop 프로젝트 자율 개발 시작

1. /agents 명령으로 8개 에이전트(orchestrator, planner, architect, designer,
   backend-dev, frontend-dev, tester, qc-reviewer)가 모두 인식되는지 확인.

2. Task 도구를 사용해 orchestrator를 호출:
   - 목표: docs/PLAN.md를 읽고 Phase 0 부트스트랩 절차를 실행
   - 검증: shared/{STATUS,HANDOFF,DECISIONS,BLOCKERS}.md 생성 확인
   - 다음 단계: Phase 1 (Planner에게 catalog 모듈 spec 작성 위임)

3. orchestrator의 결과를 받고 사용자에게 보고.
   - 무엇이 끝났는지
   - 다음에 무엇을 할지
   - 막힌 게 있는지

이후 명령 없이도 orchestrator가 Phase 5 QC가 GO 할 때까지
순차적으로 모든 에이전트를 호출하며 자율 진행하도록 한다.

진행 중 P0 블로커나 사용자 결정이 필요한 사안 발견 시에만 멈추고
사용자에게 보고.
```

## ✅ Step 7. 진행 상황 확인 (수시로)

오토파일럿 동작 중 다른 터미널 탭에서:

```bash
# 전체 상태 한눈에
cat shared/STATUS.md

# 막힌 이슈 확인
cat shared/BLOCKERS.md

# 최근 의사결정
cat shared/DECISIONS.md

# 진행 중 spec 보기
ls docs/specs/
```

## ✅ Step 8. Phase 1 MVP 완료 후 검증

오토파일럿이 Phase 1 MVP를 완료하면:

```bash
# 1. 타입 체크
npm run typecheck

# 2. 전체 테스트
npm test -- --coverage

# 3. E2E
npm run e2e

# 4. 빌드
npm run build

# 5. 로컬 실행
npm run dev
# http://localhost:3000 접속, 다음 플로우 직접 확인:
#  - 랜딩 → 카탈로그 → 상품 상세 → 사진 업로드 → 편집 → 장바구니 → 결제(테스트모드)
```

---

## 🚨 자주 발생하는 문제와 대응

### Q1. orchestrator가 Task 도구를 못 찾는다고 한다
A. Claude Code 최신 버전인지 확인. `claude --version` 이 2.x 이상이어야 sub-agent task delegation 지원.

### Q2. Konva 빌드 에러 (canvas 모듈)
A. Next.js 15 + Node 24 조합에서 canvas 모듈이 빌드 안 됨. 
`package.json`의 `engines.node`를 `"20.x"`로 고정하고 Vercel 대시보드 Node 버전도 20으로 변경.

### Q3. Supabase 마이그레이션 적용 실패
A. `npx supabase link --project-ref <ref>` 먼저 실행. RLS 정책은 마지막 마이그레이션에서 한 번에 적용.

### Q4. 토스페이먼츠 webhook이 로컬에서 안 잡힌다
A. `ngrok` 또는 `cloudflared tunnel`로 HTTPS 터널 만들어 webhook URL 등록.

### Q5. orchestrator가 같은 에이전트를 무한 호출
A. `shared/STATUS.md`를 직접 보고 어디가 막혔는지 확인. 보통 BLOCKERS에 모호한 요구사항이 있음. 
PLAN.md를 명확하게 수정 후 재시작.

### Q6. 옵션 매트릭스가 너무 많아 관리 못함
A. `/admin/options`에서 CSV import 기능 사용. 사이즈×색상 2D 표 UI로 토글 가능.

---

## 📦 개발 완료 후 산출물

```
frameshop/
├── docs/
│   ├── PLAN.md
│   ├── specs/              # 10개 모듈 명세
│   ├── audit/              # Phase별 QC 리포트
│   └── design-system.md
├── shared/
│   └── INTERFACES/         # 타입/API 계약
├── src/
│   ├── types/              # 모든 TypeScript 타입
│   ├── modules/            # 비즈니스 로직
│   ├── components/         # UI
│   ├── lib/                # 인프라
│   └── store/              # Zustand
├── supabase/
│   └── migrations/         # 11개 마이그레이션
├── tests/
│   ├── unit/               # 80%+ 커버리지
│   ├── integration/
│   └── e2e/                # 사용자/관리자/모바일
└── .claude/agents/         # 재사용 가능한 에이전트
```

---

## 🎯 Phase별 마감 기준 (체크리스트)

### Phase 1 MVP (4주)
- [ ] 1개 카테고리, 1개 상품으로 풀 플로우 작동
- [ ] 사진 업로드 → 옵션 변경 → 장바구니 → 결제(테스트)
- [ ] 관리자 콘솔에서 상품 등록 가능
- [ ] 모바일 우선 디자인 완성
- [ ] 핵심 유닛 테스트 P0 영역 80%+

### Phase 2 확장 (3주)
- [ ] 옵션 매트릭스 풀 지원 (사이즈/색상/매트/인화지)
- [ ] 명화이미지 갤러리
- [ ] 우편번호 API 정식 연동
- [ ] 큐레이션 시스템 (배너/컬렉션)
- [ ] PC 반응형 최적화

### Phase 3 고도화 (4주)
- [ ] 클라우드 사진 가져오기 (구글)
- [ ] 300dpi 인쇄용 자동 렌더링
- [ ] 다중 PG (포트원 통합)
- [ ] 마이페이지 (재주문)
- [ ] Sentry 모니터링

### Phase 4 운영 (지속)
- [ ] A/B 테스트
- [ ] SEO sitemap
- [ ] i18n 영어

---

**시작할 준비가 되었습니다. Step 1부터 차례대로 따라가세요.** 🚀
