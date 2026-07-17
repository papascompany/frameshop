/**
 * notifyInquiryReplied — FS-X-02.
 *
 * 기존 Resend 패턴 계약: 키/수신자 없으면 no-op, 발송 실패는 warn only
 * (상위 호출 = 답변 저장으로 절대 전파되지 않는다). 실제 모듈을 import 해
 * 검증한다(인라인 재현 아님).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settingsState = { values: {} as Record<string, string> };

vi.mock('@/lib/db/settings', () => ({
  getSettings: vi.fn(async () => settingsState.values),
}));

import { notifyInquiryReplied } from '@/lib/notify';

describe('notifyInquiryReplied', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let origFetch: typeof global.fetch;
  let origApiKey: string | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    origFetch = global.fetch;
    origApiKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    settingsState.values = {};
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof global.fetch;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = origFetch;
    if (origApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = origApiKey;
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('Resend API 키가 없으면 no-op (fetch 미호출)', async () => {
    await notifyInquiryReplied('customer@example.com', {
      subject: '배송 문의',
      replyText: '내일 출고됩니다.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('수신 이메일이 비어 있으면 no-op', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    await notifyInquiryReplied('', { subject: '문의', replyText: '답변' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('env 키가 있으면 Resend API 를 호출하고 본문에 제목/답변을 담는다', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    await notifyInquiryReplied('customer@example.com', {
      subject: '배송 문의',
      replyText: '내일 출고됩니다.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer re_test_key' }),
      }),
    );
    const callBody = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    ) as { to: string[]; subject: string; text: string };
    expect(callBody.to).toContain('customer@example.com');
    expect(callBody.subject).toContain('배송 문의');
    expect(callBody.text).toContain('내일 출고됩니다.');
  });

  it('env 키가 없어도 settings(resend_api_key) 폴백으로 발송한다', async () => {
    settingsState.values = { resend_api_key: 're_settings_key' };
    await notifyInquiryReplied('customer@example.com', {
      subject: '문의',
      replyText: '답변',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer re_settings_key' }),
      }),
    );
  });

  it('fetch 가 reject 해도 예외가 상위로 전파되지 않는다(warn only)', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(
      notifyInquiryReplied('customer@example.com', { subject: '문의', replyText: '답변' }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('non-2xx 응답도 warn only 로 삼킨다', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => 'bad' });

    await expect(
      notifyInquiryReplied('customer@example.com', { subject: '문의', replyText: '답변' }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
