# Blockers

> 진행을 막는 이슈. 해결되면 "Resolved" 섹션으로 이동.

## Format
```
### BL-NNN: <제목>
**Reported by:** <agent>
**Date:** YYYY-MM-DD
**Severity:** P0 (즉시 해결) | P1 (이번 phase 내) | P2 (다음 phase)
**Description:** 무엇이 막혔는지
**Needs:** 누구의 결정/액션이 필요한가
**Proposed Resolutions:** 가능한 해결책 2-3개
```

---

## Active Blockers
_(현재 막힌 이슈. 비어있어야 정상)_

### BL-010: 미적용 마이그레이션 029/030/031/032/033 (CTO 수동 적용 필요)
**Reported by:** orchestrator
**Date:** 2026-06-22
**Severity:** P1
**Description:** 관리자 메모(029)·주소록(032)·구매확정(033)은 코드가 라이브이나 DB 컬럼/테이블
미적용으로 해당 기능만 런타임 비활성. 적립금(031)·추가배송비(030)는 B-2/Phase C wiring 대기.
코드는 격리 설계되어 미적용 중에도 나머지 앱은 정상.
**Needs:** CTO가 Supabase SQL Editor(yohan73@gmail.com 계정)에서 직접 적용. Claude의 Supabase
MCP는 papascompany 계정이라 해당 프로젝트 접근 불가.
**Proposed Resolutions:** (1) `supabase/migrations/029,032,033` 먼저 적용 → A/B-1 완성,
(2) B-2 착수 시 031 + 신규(refunded_amount, receipt_*) 적용. 상세 `docs/BACKLOG.md §1`.

## Resolved Blockers
_(해결 완료. 학습용으로 보관)_

### BL-009: Vercel 자동배포 누락/Blocked (storigehub 작성 커밋) — 완화됨 2026-06-22
**Description:** Hobby 비공개 레포에서 `storigehub` 작성 커밋의 배포가 Blocked → main 커밋이
올라가도 배포 미생성.
**Resolution:** 레포 git author를 `PapasCompany`(noreply 이메일)로 설정 → PR 머지가 papascompany
작성 main 커밋이 되어 자동 Ready 배포. 근본해결은 Pro 업그레이드 또는 레포 Public 전환(`docs/BACKLOG.md §6`).
