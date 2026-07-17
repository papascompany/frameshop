/**
 * adminNav SSOT — 문의/쿠폰 항목 추가 (FS-X-05).
 *
 * 고정하는 계약:
 *  1. inquiries('/admin/inquiries', '문의')·coupons('/admin/coupons', '쿠폰')이
 *     ops 섹션에 존재한다.
 *  2. 모바일 하단바(inBottomNav)는 5개 만석 그대로 — 신규 항목 미포함.
 *  3. 파생 뷰(adminNavBySection/adminBottomNavItems)가 순서를 보존한다.
 */

import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV,
  adminBottomNavItems,
  adminNavBySection,
  isAdminNavActive,
} from '@/lib/admin/adminNav';

describe('adminNav — inquiries/coupons (FS-X-05)', () => {
  it('inquiries 항목: /admin/inquiries, 라벨 "문의", ops 섹션', () => {
    const item = ADMIN_NAV.find((i) => i.key === 'inquiries');
    expect(item).toMatchObject({
      href: '/admin/inquiries',
      label: '문의',
      section: 'ops',
    });
  });

  it('coupons 항목: /admin/coupons, 라벨 "쿠폰", ops 섹션', () => {
    const item = ADMIN_NAV.find((i) => i.key === 'coupons');
    expect(item).toMatchObject({
      href: '/admin/coupons',
      label: '쿠폰',
      section: 'ops',
    });
  });

  it('모바일 하단바는 5개 만석 그대로 — 신규 항목 미포함', () => {
    const bottom = adminBottomNavItems();
    expect(bottom).toHaveLength(5);
    expect(bottom.map((i) => i.key)).not.toContain('inquiries');
    expect(bottom.map((i) => i.key)).not.toContain('coupons');
  });

  it('ops 섹션 파생이 노출 순서를 보존한다 (reviews → inquiries → coupons)', () => {
    const keys = adminNavBySection('ops').map((i) => i.key);
    expect(keys).toContain('inquiries');
    expect(keys).toContain('coupons');
    expect(keys.indexOf('reviews')).toBeLessThan(keys.indexOf('inquiries'));
    expect(keys.indexOf('inquiries')).toBeLessThan(keys.indexOf('coupons'));
  });

  it('활성 판정: /admin/coupons 이하 prefix 활성, /admin(대시보드)은 비활성', () => {
    expect(isAdminNavActive('/admin/coupons', '/admin/coupons')).toBe(true);
    expect(isAdminNavActive('/admin/inquiries?status=OPEN', '/admin/inquiries')).toBe(true);
    expect(isAdminNavActive('/admin/coupons', '/admin')).toBe(false);
  });
});
