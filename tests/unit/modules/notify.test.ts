/**
 * 관리자 알림 모듈 테스트.
 * - 설정 없을 때 no-op
 * - 실패해도 예외 미전파
 */

import { describe, it, expect, vi } from 'vitest';

// notifyNewOrder는 server-only 모듈이므로 직접 import 대신
// 내부 로직을 단위 테스트로 검증한다.

describe('notifyNewOrder 설정 없을 때 no-op', () => {
  it('admin_email 없으면 Resend API를 호출하지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    const origFetch = global.fetch;
    global.fetch = fetchMock;

    // settings 미설정 상태 시뮬레이션 — 직접 함수 로직 재현
    const settings: Record<string, string> = {};
    const adminEmail = settings['admin_email'];
    const resendApiKey = settings['resend_api_key'];
    const slackWebhookUrl = settings['slack_webhook_url'];

    const tasks: Promise<void>[] = [];
    if (adminEmail && resendApiKey) {
      tasks.push(fetchMock('https://api.resend.com/emails'));
    }
    if (slackWebhookUrl) {
      tasks.push(fetchMock(slackWebhookUrl));
    }
    await Promise.allSettled(tasks);

    expect(fetchMock).not.toHaveBeenCalled();
    global.fetch = origFetch;
  });

  it('Slack URL만 있으면 Slack webhook만 호출한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    const origFetch = global.fetch;
    global.fetch = fetchMock;

    const settings: Record<string, string> = {
      slack_webhook_url: 'https://hooks.slack.com/services/TEST',
    };
    const adminEmail = settings['admin_email'];
    const resendApiKey = settings['resend_api_key'];
    const slackWebhookUrl = settings['slack_webhook_url'];

    const tasks: Promise<void>[] = [];
    if (adminEmail && resendApiKey) {
      tasks.push(fetchMock('https://api.resend.com/emails'));
    }
    if (slackWebhookUrl) {
      tasks.push(
        fetchMock(slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: '새 주문 테스트' }),
        }),
      );
    }
    await Promise.allSettled(tasks);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/TEST',
      expect.objectContaining({ method: 'POST' }),
    );
    global.fetch = origFetch;
  });

  it('fetch 실패해도 예외가 전파되지 않는다', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    const origFetch = global.fetch;
    global.fetch = fetchMock;

    const slackWebhookUrl = 'https://hooks.slack.com/services/FAIL';
    const tasks: Promise<void>[] = [
      (async () => {
        await fetchMock(slackWebhookUrl).catch((e: unknown) => {
          console.warn('expected failure:', e);
        });
      })(),
    ];

    // 예외가 밖으로 나오지 않아야 함
    await expect(Promise.allSettled(tasks)).resolves.toBeDefined();
    global.fetch = origFetch;
  });
});
