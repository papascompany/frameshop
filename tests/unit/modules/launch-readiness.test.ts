/**
 * 런칭 준비 점검 — 판정 순수 함수(evaluateLaunchReadiness / describeTossKey).
 *
 * 고정하는 계약:
 *  1. 모든 항목이 채워진 스냅샷은 blocker·warn 0 (manual 은 웹훅 등록·호스팅 2개 고정).
 *  2. Toss 키: 미설정 blocker, test/live 불일치 blocker, 역할 뒤바뀜 blocker,
 *     접두사 불명 warn. 웹훅 보안 키는 유무와 무관하게 ok.
 *  3. 사이트 URL 비어 있음/http/형식 오류 blocker, CRON_SECRET 없음 blocker.
 *  4. 배송: 활성 0 blocker, STANDARD 추가배송비 0 warn, 조회 실패 manual.
 *  5. 알림·법적 고지·Sentry 미설정 warn, 마이그레이션 043 만 미적용 warn / 그 외 blocker.
 *  6. 키 원문은 판정 결과 어디에도 나오지 않는다(describeTossKey 가 원문을 버림).
 */

import { describe, expect, it } from 'vitest';
import {
  describeTossKey,
  evaluateLaunchReadiness,
  type LaunchSnapshot,
  type ReadinessItem,
} from '@/lib/launch/readiness';

const CLIENT_TEST = 'test_ck_SAMPLEclientVALUE001';
const SECRET_TEST = 'test_sk_SAMPLEsecretVALUE002';
const CLIENT_LIVE = 'live_ck_SAMPLEclientVALUE003';
const SECRET_LIVE = 'live_sk_SAMPLEsecretVALUE004';

function healthySnapshot(): LaunchSnapshot {
  return {
    toss: {
      clientKey: describeTossKey(CLIENT_LIVE, 'db'),
      secretKey: describeTossKey(SECRET_LIVE, 'db'),
      webhookSecretPresent: false,
    },
    siteUrl: 'https://shop.example.com',
    cronSecretPresent: true,
    shipping: {
      activeMethods: [
        { code: 'STANDARD', label: '택배', surchargeFeeJeju: 3000, surchargeFeeRemote: 5000 },
        { code: 'PICKUP', label: '방문 수령', surchargeFeeJeju: 0, surchargeFeeRemote: 0 },
      ],
    },
    notify: { adminEmail: true, resendApiKey: true, mailFrom: true },
    legal: {
      email: 'help@example.com',
      mailOrderSalesNo: '2026-서울종로-00001',
      hosting: 'Vercel Inc.',
      effectiveDate: '2026-12-01',
      processorNames: ['토스페이먼츠(주)', 'CJ대한통운(주)', 'Vercel Inc.', 'Supabase Inc.'],
      mailOrderOverridden: true,
      hostingOverridden: true,
      draftNoticeVisible: false,
    },
    sentryDsnPresent: true,
    migrations: [
      { migration: '042', label: '쿠폰', available: true },
      { migration: '043', label: '웹훅 수신 감사 로그', available: true },
    ],
  };
}

function itemOf(snapshot: LaunchSnapshot, id: string): ReadinessItem {
  const item = evaluateLaunchReadiness(snapshot).items.find((i) => i.id === id);
  if (!item) throw new Error(`item ${id} not found`);
  return item;
}

describe('describeTossKey — 모드/역할만 남기고 원문을 버린다', () => {
  it('test/live 접두사와 ck/sk·위젯(gck/gsk) 역할을 판별한다', () => {
    expect(describeTossKey(CLIENT_TEST, 'env')).toEqual({
      present: true,
      source: 'env',
      mode: 'test',
      role: 'client',
    });
    expect(describeTossKey(SECRET_LIVE, 'db')).toMatchObject({ mode: 'live', role: 'secret' });
    expect(describeTossKey('live_gck_SAMPLE', 'db')).toMatchObject({ mode: 'live', role: 'client' });
    expect(describeTossKey('test_gsk_SAMPLE', 'db')).toMatchObject({ mode: 'test', role: 'secret' });
    expect(describeTossKey('sk_unknown_SAMPLE', 'db')).toMatchObject({
      mode: 'unknown',
      role: 'unknown',
    });
  });

  it('null·빈 문자열·공백은 미설정', () => {
    expect(describeTossKey(null, 'db')).toEqual({ present: false });
    expect(describeTossKey('', 'env')).toEqual({ present: false });
    expect(describeTossKey('   ', 'db')).toEqual({ present: false });
  });

  it('반환값에 키 원문이 포함되지 않는다', () => {
    expect(JSON.stringify(describeTossKey(SECRET_TEST, 'db'))).not.toContain('SAMPLE');
  });
});

describe('evaluateLaunchReadiness — 전체', () => {
  it('모두 채워진 스냅샷: blocker·warn 0, manual 은 웹훅 등록·호스팅 2개', () => {
    const { summary, items } = evaluateLaunchReadiness(healthySnapshot());
    expect(summary.blocker).toBe(0);
    expect(summary.warn).toBe(0);
    expect(summary.manual).toBe(2);
    expect(items.filter((i) => i.status === 'manual').map((i) => i.id).sort()).toEqual([
      'hosting-plan',
      'toss-webhook-url',
    ]);
    expect(summary.ok + summary.manual).toBe(items.length);
  });

  it('요약 개수는 항목 상태 합과 같다', () => {
    const snap = healthySnapshot();
    snap.cronSecretPresent = false;
    snap.sentryDsnPresent = false;
    const { summary, items } = evaluateLaunchReadiness(snap);
    expect(summary.blocker).toBe(items.filter((i) => i.status === 'blocker').length);
    expect(summary.warn).toBe(items.filter((i) => i.status === 'warn').length);
    expect(summary.blocker + summary.warn + summary.ok + summary.manual).toBe(items.length);
  });
});

describe('Toss 결제 키', () => {
  it('둘 다 미설정 → blocker, 두 키를 모두 나열', () => {
    const snap = healthySnapshot();
    snap.toss.clientKey = { present: false };
    snap.toss.secretKey = { present: false };
    const item = itemOf(snap, 'toss-keys');
    expect(item.status).toBe('blocker');
    expect(item.message).toContain('클라이언트 키·시크릿 키');
    expect(item.fix?.href).toBe('/admin/settings?tab=payment');
  });

  it('시크릿 키만 미설정 → blocker', () => {
    const snap = healthySnapshot();
    snap.toss.secretKey = { present: false };
    expect(itemOf(snap, 'toss-keys').status).toBe('blocker');
  });

  it('test/live 모드 불일치 → blocker', () => {
    const snap = healthySnapshot();
    snap.toss.clientKey = describeTossKey(CLIENT_TEST, 'env');
    snap.toss.secretKey = describeTossKey(SECRET_LIVE, 'db');
    const item = itemOf(snap, 'toss-keys');
    expect(item.status).toBe('blocker');
    expect(item.message).toContain('모드가 다릅니다');
  });

  it('클라이언트 자리에 시크릿 키 → blocker (브라우저 노출 경고)', () => {
    const snap = healthySnapshot();
    snap.toss.clientKey = describeTossKey(SECRET_LIVE, 'db');
    const item = itemOf(snap, 'toss-keys');
    expect(item.status).toBe('blocker');
    expect(item.message).toContain('브라우저');
  });

  it('시크릿 자리에 클라이언트 키 → blocker', () => {
    const snap = healthySnapshot();
    snap.toss.secretKey = describeTossKey(CLIENT_LIVE, 'db');
    expect(itemOf(snap, 'toss-keys').status).toBe('blocker');
  });

  it('접두사 불명 → warn', () => {
    const snap = healthySnapshot();
    snap.toss.secretKey = describeTossKey('SAMPLEnoPrefix', 'db');
    expect(itemOf(snap, 'toss-keys').status).toBe('warn');
  });

  it('테스트 모드 한 쌍 → ok + 라이브 교체 안내, 상세는 모드·출처만', () => {
    const snap = healthySnapshot();
    snap.toss.clientKey = describeTossKey(CLIENT_TEST, 'env');
    snap.toss.secretKey = describeTossKey(SECRET_TEST, 'db');
    const item = itemOf(snap, 'toss-keys');
    expect(item.status).toBe('ok');
    expect(item.message).toContain('라이브 키로 교체');
    expect(item.details).toEqual([
      '클라이언트 키: 테스트 모드 (환경변수)',
      '시크릿 키: 테스트 모드 (어드민 설정)',
    ]);
  });

  it('웹훅 보안 키는 유무와 무관하게 ok', () => {
    const snap = healthySnapshot();
    expect(itemOf(snap, 'toss-webhook-secret').status).toBe('ok');
    snap.toss.webhookSecretPresent = true;
    expect(itemOf(snap, 'toss-webhook-secret').status).toBe('ok');
  });

  it('웹훅 등록은 manual — 사이트 origin 기반 URL 과 이벤트명을 안내', () => {
    const snap = healthySnapshot();
    snap.siteUrl = 'https://shop.example.com/';
    const item = itemOf(snap, 'toss-webhook-url');
    expect(item.status).toBe('manual');
    expect(item.details).toEqual([
      'URL: https://shop.example.com/api/webhook/payment',
      '이벤트: PAYMENT_STATUS_CHANGED',
    ]);
  });
});

describe('사이트 URL · CRON_SECRET', () => {
  it.each([
    ['미설정', null],
    ['빈 문자열', '  '],
    ['http', 'http://shop.example.com'],
    ['형식 오류', 'shop.example.com'],
  ])('%s → blocker', (_label, siteUrl) => {
    const snap = healthySnapshot();
    snap.siteUrl = siteUrl;
    expect(itemOf(snap, 'site-url').status).toBe('blocker');
  });

  it('https → ok', () => {
    expect(itemOf(healthySnapshot(), 'site-url').status).toBe('ok');
  });

  it('CRON_SECRET 없음 → blocker, 있음 → ok', () => {
    const snap = healthySnapshot();
    expect(itemOf(snap, 'cron-secret').status).toBe('ok');
    snap.cronSecretPresent = false;
    const item = itemOf(snap, 'cron-secret');
    expect(item.status).toBe('blocker');
    expect(item.message).toContain('401');
  });
});

describe('배송', () => {
  it('활성 배송 방법 0개 → blocker', () => {
    const snap = healthySnapshot();
    snap.shipping = { activeMethods: [] };
    expect(itemOf(snap, 'shipping-methods').status).toBe('blocker');
  });

  it('STANDARD 제주/도서산간 0원 → warn, 0원 항목을 나열', () => {
    const snap = healthySnapshot();
    snap.shipping = {
      activeMethods: [
        { code: 'STANDARD', label: '택배', surchargeFeeJeju: 0, surchargeFeeRemote: 5000 },
      ],
    };
    const item = itemOf(snap, 'shipping-surcharge');
    expect(item.status).toBe('warn');
    expect(item.details).toEqual(['택배: 제주 추가배송비 0원']);
  });

  it('PICKUP 의 0원 추가배송비는 판정 대상이 아니다', () => {
    expect(itemOf(healthySnapshot(), 'shipping-surcharge').status).toBe('ok');
  });

  it('조회 실패 → manual (추가배송비 항목 생략)', () => {
    const snap = healthySnapshot();
    snap.shipping = null;
    const { items } = evaluateLaunchReadiness(snap);
    expect(items.find((i) => i.id === 'shipping-methods')?.status).toBe('manual');
    expect(items.find((i) => i.id === 'shipping-surcharge')).toBeUndefined();
  });
});

describe('알림 · 법적 고지 · Sentry', () => {
  it('알림 키 하나라도 없으면 warn, 빠진 항목만 나열', () => {
    const snap = healthySnapshot();
    snap.notify = { adminEmail: true, resendApiKey: false, mailFrom: false };
    const item = itemOf(snap, 'notify-email');
    expect(item.status).toBe('warn');
    expect(item.details).toHaveLength(2);
    expect(item.details?.[0]).toContain('Resend');
  });

  it('placeholder 남은 법적 고지 → warn, 항목 나열', () => {
    const snap = healthySnapshot();
    snap.legal = {
      ...snap.legal,
      email: 'help@papascompany.co.kr(확정 필요)',
      effectiveDate: '2026-07-03(초안 작성일 — 시행일 확정 필요)',
      processorNames: ['토스페이먼츠(주)', '배송사(택배사) — (확정 필요)', 'Vercel Inc.(확정 필요 — 국외: 미국)'],
      mailOrderOverridden: false,
      hostingOverridden: false,
      hosting: 'AWS',
    };
    const item = itemOf(snap, 'legal-company');
    expect(item.status).toBe('warn');
    expect(item.details).toEqual([
      '고객문의 이메일',
      '통신판매업신고번호 — FrameShop 명의 확정값 미입력(정적 기본값 사용 중)',
      '호스팅 사업자 표기 — 확정값 미입력(정적 기본값 "AWS")',
      '약관·방침 시행일',
      '개인정보 처리위탁: 배송사(택배사)',
      '개인정보 처리위탁: Vercel Inc.(확정 필요 — 국외: 미국) — 코드(src/lib/legal/company.ts) 수정 필요',
    ]);
  });

  it('초안 고지 게시 중 → warn, 숨김 → ok', () => {
    const snap = healthySnapshot();
    expect(itemOf(snap, 'legal-draft-notice').status).toBe('ok');
    snap.legal.draftNoticeVisible = true;
    expect(itemOf(snap, 'legal-draft-notice').status).toBe('warn');
  });

  it('Sentry DSN 없음 → warn', () => {
    const snap = healthySnapshot();
    snap.sentryDsnPresent = false;
    expect(itemOf(snap, 'sentry-dsn').status).toBe('warn');
  });
});

describe('마이그레이션', () => {
  it('043 만 미적용 → warn', () => {
    const snap = healthySnapshot();
    snap.migrations = [
      { migration: '042', label: '쿠폰', available: true },
      { migration: '043', label: '웹훅 수신 감사 로그', available: false },
    ];
    const item = itemOf(snap, 'migrations');
    expect(item.status).toBe('warn');
    expect(item.details).toEqual(['✓ 042 쿠폰', '✗ 043 웹훅 수신 감사 로그']);
  });

  it('043 외 미적용 → blocker', () => {
    const snap = healthySnapshot();
    snap.migrations = [
      { migration: '042', label: '쿠폰', available: false },
      { migration: '043', label: '웹훅 수신 감사 로그', available: false },
    ];
    expect(itemOf(snap, 'migrations').status).toBe('blocker');
  });
});

describe('값 미노출', () => {
  it('어떤 키 조합에서도 판정 결과에 키 원문이 없다', () => {
    const combos: Array<[string, string]> = [
      [CLIENT_TEST, SECRET_TEST],
      [CLIENT_TEST, SECRET_LIVE],
      [SECRET_LIVE, CLIENT_LIVE],
      ['SAMPLEnoPrefix', SECRET_TEST],
    ];
    for (const [client, secret] of combos) {
      const snap = healthySnapshot();
      snap.toss.clientKey = describeTossKey(client, 'env');
      snap.toss.secretKey = describeTossKey(secret, 'db');
      const serialized = JSON.stringify(evaluateLaunchReadiness(snap));
      expect(serialized).not.toContain('SAMPLE');
    }
  });
});
