# 📦 FrameShop 패키지

> Z 스타일 액자 주문 SaaS — Claude Code 자율 개발 패키지

## 📂 포함된 파일

```
frameshop-package/
├── README.md                          ← 이 문서
├── START_HERE.md                      ← 🚀 첫 실행 가이드 (먼저 읽기)
│
├── docs/
│   ├── PLAN.md                        ← 📘 메인 개발계획서 (이 프로젝트의 단일 진실 원천)
│   └── guides/
│       └── konva-patterns.md          ← 캔버스 편집기 구현 노하우
│
├── .claude/agents/                    ← 8개 sub-agent 정의 (Claude Code가 자동 인식)
│   ├── orchestrator.md                ← 🎯 오토파일럿 (전체 조율)
│   ├── planner.md                     ← 요구사항 분해 + 명세
│   ├── architect.md                   ← 타입 + DB 스키마
│   ├── designer.md                    ← 디자인 시스템 + UI
│   ├── backend-dev.md                 ← Supabase + API + 결제
│   ├── frontend-dev.md                ← Next.js + Konva
│   ├── tester.md                      ← TDD + Vitest + Playwright
│   └── qc-reviewer.md                 ← 보안 + 성능 + 품질 감사
│
└── shared/                            ← 에이전트들이 공유하는 상태 파일
    ├── STATUS.md                      ← 전체 진행 상황
    ├── HANDOFF.md                     ← 에이전트 간 인계
    ├── DECISIONS.md                   ← ADR 의사결정 기록 (7개 사전 작성)
    └── BLOCKERS.md                    ← 막힌 이슈
```

## ⚡ 빠른 시작 (3분)

1. **압축 해제 → 신규 폴더로 복사**
   ```bash
   mkdir frameshop && cd frameshop
   # 이 ZIP의 모든 파일을 frameshop/ 로 옮기기
   ```

2. **Next.js 초기화 (기존 파일 덮어쓰기 주의)**
   ```bash
   npx create-next-app@latest . \
     --typescript --tailwind --app --src-dir \
     --eslint --import-alias "@/*"
   ```

3. **Claude Code 실행**
   ```bash
   claude
   ```

4. **첫 명령 입력** (START_HERE.md의 Step 6 참조)
   ```
   오케스트레이터에게 작업을 위임한다.
   docs/PLAN.md를 읽고 Phase 0 부트스트랩부터 실행해줘.
   ```

## 🧭 어떤 순서로 읽어야 하나

| 우선순위 | 파일 | 설명 |
|---|---|---|
| 1️⃣ | `START_HERE.md` | 실행 절차 |
| 2️⃣ | `docs/PLAN.md` | 전체 계획 (큰 그림) |
| 3️⃣ | `.claude/agents/orchestrator.md` | 오토파일럿이 어떻게 동작하는지 |
| 4️⃣ | `shared/DECISIONS.md` | 사전 의사결정 7건 |
| 5️⃣ | 나머지 에이전트 파일 | 각 역할 상세 |

## ✅ 이 패키지의 보장 사항

- ✅ 7개 캡처화면을 빠짐없이 분해해 모듈로 매핑
- ✅ 비즈니스 로직을 5개 그룹(A~E)으로 체계적 분류
- ✅ 10개 모듈로 적절히 분할 (Over-engineering 회피)
- ✅ TDD 방법론 — Tester가 Red 먼저, Dev가 Green
- ✅ 8개 sub-agent로 자율 운영 가능
- ✅ 검증된 스킬(`/mnt/skills/public/frontend-design`) 활용
- ✅ 5개 신규 커스텀 스킬 필요성 명시
- ✅ ZZIXX 디자인 미학 토큰화 (다크 헤더, 빨강 가격, Pretendard)
- ✅ PC + 모바일 반응형 (모바일 우선)
- ✅ 결제(토스), 우편번호(카카오) 등 한국 시장 표준 PG/API 명시

## 🎯 1단계 마감 후 산출물 (예상)

Phase 1 MVP (4주 후):
- 사용자가 사진 업로드 → 옵션 변경 → 결제까지 가능한 작동 앱
- 관리자가 상품 등록 → 즉시 사용자에 노출
- 핵심 비즈니스 로직 80%+ 테스트 커버리지
- 모바일 + PC 반응형

## ❓ 막혔을 때

1. `shared/BLOCKERS.md` 확인 → 에이전트가 도움 요청한 내용
2. `shared/STATUS.md` 확인 → 어디까지 끝났나
3. `docs/PLAN.md`에서 답을 찾을 수 있다면 → 에이전트에게 PLAN.md를 다시 읽으라고 명령
4. PLAN.md에도 없는 새 요구사항 → PLAN.md를 직접 수정 후 재시작

## 📝 라이선스

이 개발계획서는 Papas Company 내부 사용을 위해 작성되었습니다.
Claude/Anthropic이 생성한 가이드를 자유롭게 수정 및 활용할 수 있습니다.

---

**Built with:** Claude Opus 4.7
**For:** Papas Company (파파스컴퍼니)
**Date:** 2026-05-11
