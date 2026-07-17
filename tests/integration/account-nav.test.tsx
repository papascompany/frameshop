/**
 * Account 레이아웃 NAV — FS-X-06.
 * 위시리스트/1:1 문의 항목이 마이페이지 사이드바에 추가됐는지 고정한다.
 *
 * AccountLayout 은 async 서버 컴포넌트 — vitest 에는 next-intl 요청 컨텍스트가
 * 없으므로 getTranslations 를 ko 메시지 조회 함수로 대체하고, JSX 를 await 해
 * 렌더한다.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import koMessages from '@/messages/ko.json';

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns?: string) => (key: string) => {
    const full = ns ? `${ns}.${key}` : key;
    const value = full
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        koMessages,
      );
    return typeof value === 'string' ? value : full;
  },
}));

import AccountLayout from '@/app/(shop)/account/layout';

describe('AccountLayout NAV', () => {
  it('위시리스트/1:1 문의 항목이 기존 항목과 함께 렌더된다', async () => {
    render(await AccountLayout({ children: <div data-testid="child" /> }));

    // 기존 항목 무파손.
    expect(screen.getByRole('link', { name: '주문 내역' })).toHaveAttribute(
      'href',
      '/account/orders',
    );
    expect(screen.getByRole('link', { name: '적립금' })).toHaveAttribute(
      'href',
      '/account/points',
    );
    expect(screen.getByRole('link', { name: '배송지 관리' })).toHaveAttribute(
      'href',
      '/account/addresses',
    );

    // FS-X-06 신규 항목.
    expect(screen.getByRole('link', { name: '위시리스트' })).toHaveAttribute(
      'href',
      '/account/wishlist',
    );
    expect(screen.getByRole('link', { name: '1:1 문의' })).toHaveAttribute(
      'href',
      '/account/inquiries',
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
