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

_(없음)_

## Resolved Blockers
_(해결 완료. 학습용으로 보관)_

### BL-010: 미적용 마이그레이션 029~039 — 해소됨 2026-07-06
**Description:** 관리자 메모(029)·주소록(032)·구매확정(033) 등 코드는 라이브이나 DB 미적용으로
런타임 비활성. Claude의 Supabase MCP/CLI가 papascompany 계정이라 직접 적용 불가였음.
**Resolution:** CTO가 브라우저에서 yohan73@gmail.com 로그인 → Claude가 Supabase SQL Editor에서
통합 SQL(029~035, 038/039 — 전부 비파괴·멱등)을 실행. 검증 쿼리 24행 전부 일치(orders 10컬럼·
cart/order 프로젝트 링크 6컬럼·product_type·테이블 4종·RPC). 프로덕션 런타임 자동 활성화 확증
(체크아웃 RSC `features:{points:true,receipt:true,surcharge:true}` — 재배포 없이 probe 활성화).
036/037은 확장형 P2 예약 결번.

### BL-009: Vercel 자동배포 누락/Blocked (storigehub 작성 커밋) — 완화됨 2026-06-22
**Description:** Hobby 비공개 레포에서 `storigehub` 작성 커밋의 배포가 Blocked → main 커밋이
올라가도 배포 미생성.
**Resolution:** 레포 git author를 `PapasCompany`(noreply 이메일)로 설정 → PR 머지가 papascompany
작성 main 커밋이 되어 자동 Ready 배포. 근본해결은 Pro 업그레이드 또는 레포 Public 전환(`docs/BACKLOG.md §6`).
