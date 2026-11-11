/**
 * 로그인 후 리다이렉트 정화 (src/lib/auth/safe-redirect.ts, 보안 검토 P2-2).
 * 브라우저 URL 파서가 탭·개행을 지우고 백슬래시를 '/' 로 바꾸므로, 접두사 검사만으로는
 * `/\t/evil.example` 같은 우회가 통과했다. 같은 origin 의 경로만 남는지 고정한다.
 */

import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';

const ORIGIN = 'https://shop.example';
const FALLBACK = '/admin';

const run = (raw: string | null | undefined) => safeRedirectPath(raw, ORIGIN, FALLBACK);

describe('safeRedirectPath', () => {
  it.each([
    ['/admin/orders', '/admin/orders'],
    ['/account/orders?tab=paid', '/account/orders?tab=paid'],
    ['/products/1#reviews', '/products/1#reviews'],
    ['/', '/'],
    // 점 세그먼트는 같은 origin 안에서 정규화될 뿐이다.
    ['/a/../b', '/b'],
  ])('같은 origin 경로 %s → %s', (raw, expected) => {
    expect(run(raw)).toBe(expected);
  });

  it.each([
    ['빈 값', ''],
    ['null', null],
    ['undefined', undefined],
    ['절대 URL', 'https://evil.example/x'],
    ['javascript 스킴', 'javascript:alert(1)'],
    ['프로토콜 상대', '//evil.example'],
    ['탭 우회', '/\t/evil.example'],
    ['개행 우회', '/\n/evil.example'],
    ['CR 우회', '/\r/evil.example'],
    ['NUL', '/\u0000/evil.example'],
    ['백슬래시', '/\\evil.example'],
    ['슬래시+백슬래시', '\\/evil.example'],
    ['상대 경로', 'admin'],
    ['스킴 섞인 경로', 'http:/evil.example'],
  ])('%s → fallback', (_label, raw) => {
    expect(run(raw)).toBe(FALLBACK);
  });

  it('반환값은 언제나 단일 슬래시로 시작하는 경로다', () => {
    for (const raw of ['/x', '/%2F%2Fevil.example', '/./x', '/x?next=//evil.example']) {
      const out = run(raw);
      expect(out.startsWith('/')).toBe(true);
      expect(out.startsWith('//')).toBe(false);
      // 결과를 브라우저처럼 다시 해석해도 origin 이 바뀌지 않는다.
      expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
    }
  });
});
