/**
 * 런칭 설정 회귀 테스트 (2026-08-08).
 *
 * 1) env-public: 클라이언트 번들 인라인을 보장하려면 반드시 **리터럴 정적 접근**
 *    (`process.env.NEXT_PUBLIC_X`)이어야 한다. 동적 `process.env[name]` 은
 *    Turbopack 치환 대상이 아니라 브라우저에서 전부 undefined 가 된다
 *    (실사고: siteUrl → localhost 폴백으로 결제 successUrl 파손,
 *     supabaseUrl → throw 로 로그인 카트 동기화 무음 실패).
 * 2) 법적 고지 실값 해석: app_settings 오버라이드 우선, 미설정 시 정적 SSOT.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ dbSettings: {} as Record<string, string> }));

vi.mock('@/lib/db/settings', () => ({
  getSetting: vi.fn(async (key: string) => h.dbSettings[key] ?? null),
  getSettings: vi.fn(async (keys: string[]) => {
    const out: Record<string, string> = {};
    for (const k of keys) if (h.dbSettings[k]) out[k] = h.dbSettings[k];
    return out;
  }),
  setSetting: vi.fn(async () => undefined),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

beforeEach(() => {
  h.dbSettings = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('env-public — 클라이언트 번들 인라인 계약', () => {
  const raw = readFileSync(
    path.join(process.cwd(), 'src/lib/env-public.ts'),
    'utf8',
  );
  // 주석은 계약이 아니다 — 설명문에 등장하는 금지 패턴이 오탐되지 않도록 제거.
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('동적 process.env[...] 접근을 쓰지 않는다 (인라인 불가 패턴)', () => {
    expect(source).not.toMatch(/process\.env\s*\[/);
  });

  it('NEXT_PUBLIC 키를 리터럴 정적 접근으로 읽는다', () => {
    expect(source).toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
    expect(source).toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(source).toContain('process.env.NEXT_PUBLIC_SITE_URL');
  });

  it('tossClientKey 는 제거됐다 (서버 RSC prop 경로로 일원화)', () => {
    expect(source).not.toContain('tossClientKey');
  });
});

describe('getLegalInfo — 확정 대기 값의 어드민 오버라이드', () => {
  it('미설정이면 company.ts 정적값을 그대로 쓴다', async () => {
    const { getLegalInfo } = await import('@/lib/legal/company-settings');
    const { COMPANY } = await import('@/lib/legal/company');
    const legal = await getLegalInfo();
    expect(legal.company.email).toBe(COMPANY.email);
    expect(legal.company.mailOrderSalesNo).toBe(COMPANY.mailOrderSalesNo);
    expect(legal.company.hosting).toBe(COMPANY.hosting);
    // 초안 배너는 기본 노출.
    expect(legal.draftNotice).not.toBeNull();
  });

  it('설정값이 있으면 오버라이드한다', async () => {
    h.dbSettings = {
      company_email: 'help@frameshop.kr',
      company_mail_order_no: '2026-서울종로-01234',
      company_hosting: 'Vercel Inc.',
      company_courier: 'CJ대한통운(주)',
      legal_effective_date: '2026-09-01',
      legal_draft_notice_hidden: 'true',
    };
    const { getLegalInfo } = await import('@/lib/legal/company-settings');
    const legal = await getLegalInfo();
    expect(legal.company.email).toBe('help@frameshop.kr');
    expect(legal.company.mailOrderSalesNo).toBe('2026-서울종로-01234');
    expect(legal.company.hosting).toBe('Vercel Inc.');
    expect(legal.effectiveDate).toBe('2026-09-01');
    expect(legal.draftNotice).toBeNull();
    // 배송사 수탁 항목만 치환되고 나머지 수탁사는 유지된다.
    expect(legal.processors.some((p) => p.name === 'CJ대한통운(주)')).toBe(true);
    expect(legal.processors.some((p) => p.name.startsWith('배송사'))).toBe(false);
    expect(legal.processors.some((p) => p.name === '토스페이먼츠(주)')).toBe(true);
  });

  it('공백 문자열 설정은 무시하고 정적값을 유지한다', async () => {
    h.dbSettings = { company_email: '   ' };
    const { getLegalInfo } = await import('@/lib/legal/company-settings');
    const { COMPANY } = await import('@/lib/legal/company');
    const legal = await getLegalInfo();
    expect(legal.company.email).toBe(COMPANY.email);
  });
});
