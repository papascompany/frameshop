/**
 * admin/settings — 설정값 삭제(unset) 서버 액션.
 *
 * 고정하는 계약:
 *  1. requireAdmin 실패(비로그인·비관리자) → 거부, deleteSetting 미호출.
 *  2. 화이트리스트(env 폴백 키 + 법적 고지 값) 밖의 키 → 거부, 미호출.
 *     프로토타입 속성명(`toString`·`__proto__`)도 허용되지 않는다.
 *  3. 허용 키 → deleteSetting(key) 위임, DB 오류는 메시지로 반환.
 *     법적 고지 값 삭제(기본값 복귀)는 LEGAL_SETTINGS_TAG 도 무효화한다.
 *  4. 저장(saveSettingsAction)은 SETTABLE_SETTING_KEYS 밖의 키·길이 초과 값이 하나라도
 *     있으면 아무것도 저장하지 않고 거부한다.
 *  5. RESETTABLE_LEGAL_SETTING_KEYS 는 server-only LEGAL_SETTING_KEYS 와 같은 집합이다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asBrand } from '@/types/common';
import type { UserId } from '@/types/common';

vi.mock('@/lib/db/admin', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/db/settings', () => ({
  setSetting: vi.fn(async () => undefined),
  deleteSetting: vi.fn(async () => undefined),
}));

vi.mock('@/lib/legal/company-settings', () => ({
  LEGAL_SETTINGS_TAG: 'legal-settings',
  LEGAL_SETTING_KEYS: [
    'company_email',
    'company_mail_order_no',
    'company_hosting',
    'company_courier',
    'legal_effective_date',
    'legal_draft_notice_hidden',
  ],
}));

vi.mock('next/cache', () => ({
  updateTag: vi.fn(),
}));

import { updateTag } from 'next/cache';
import { deleteSettingAction, saveSettingsAction } from '@/app/admin/settings/actions';
import {
  DELETABLE_SETTING_ENV_FALLBACK,
  describeSettingDeletion,
  isDeletableSettingKey,
  parseSettingsTab,
  RESETTABLE_LEGAL_SETTING_KEYS,
  SETTABLE_SETTING_KEYS,
  SETTING_VALUE_MAX_LENGTH,
} from '@/app/admin/settings/setting-keys';
import { requireAdmin } from '@/lib/db/admin';
import { deleteSetting, setSetting } from '@/lib/db/settings';
import { LEGAL_SETTING_KEYS } from '@/lib/legal/company-settings';

const requireAdminMock = vi.mocked(requireAdmin);
const deleteSettingMock = vi.mocked(deleteSetting);
const setSettingMock = vi.mocked(setSetting);
const updateTagMock = vi.mocked(updateTag);

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    id: asBrand<UserId>('admin-1'),
    email: 'admin@example.com',
    role: 'admin',
  });
  deleteSettingMock.mockResolvedValue(undefined);
});

describe('deleteSettingAction — 인가', () => {
  it.each(['UNAUTHENTICATED', 'FORBIDDEN'])('requireAdmin %s → 거부, 삭제 미호출', async (code) => {
    requireAdminMock.mockRejectedValue(new Error(code));
    await expect(deleteSettingAction('toss_secret_key')).resolves.toEqual({
      ok: false,
      error: '관리자 권한이 필요합니다.',
    });
    expect(deleteSettingMock).not.toHaveBeenCalled();
  });
});

describe('deleteSettingAction — 화이트리스트', () => {
  it.each(['admin_email', 'mail_from', 'sentry_dsn', 'unknown_key', 'toString', '__proto__', ''])(
    '허용되지 않은 키 "%s" → 거부, 삭제 미호출',
    async (key) => {
      await expect(deleteSettingAction(key)).resolves.toEqual({
        ok: false,
        error: '삭제할 수 없는 설정입니다.',
      });
      expect(deleteSettingMock).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(DELETABLE_SETTING_ENV_FALLBACK))('허용 키 "%s" → deleteSetting 위임', async (key) => {
    await expect(deleteSettingAction(key)).resolves.toEqual({ ok: true });
    expect(deleteSettingMock).toHaveBeenCalledWith(key);
    expect(updateTagMock).not.toHaveBeenCalled();
  });

  it.each([...RESETTABLE_LEGAL_SETTING_KEYS])(
    '법적 고지 값 "%s" → 삭제(기본값 복귀) + 법적 고지 캐시 무효화',
    async (key) => {
      await expect(deleteSettingAction(key)).resolves.toEqual({ ok: true });
      expect(deleteSettingMock).toHaveBeenCalledWith(key);
      expect(updateTagMock).toHaveBeenCalledWith('legal-settings');
    },
  );

  it('초안 배너 숨김 삭제 문구는 배너가 다시 표시된다고 안내한다', () => {
    expect(describeSettingDeletion('legal_draft_notice_hidden', '초안 고지 배너 숨김')).toContain(
      '다시 표시',
    );
    expect(describeSettingDeletion('company_email', '고객문의 이메일')).toContain('정적 기본 표기');
    expect(describeSettingDeletion('toss_secret_key', 'Toss 시크릿 키')).toContain('TOSS_SECRET_KEY');
    expect(describeSettingDeletion('admin_email', '관리자 이메일')).toBeNull();
  });

  it('법적 고지 삭제 키 집합은 LEGAL_SETTING_KEYS 와 같다', () => {
    expect([...RESETTABLE_LEGAL_SETTING_KEYS].sort()).toEqual([...LEGAL_SETTING_KEYS].sort());
  });

  it('DB 삭제 실패는 메시지로 반환한다', async () => {
    deleteSettingMock.mockRejectedValue(new Error('[settings] deleteSetting failed'));
    await expect(deleteSettingAction('toss_secret_key')).resolves.toEqual({
      ok: false,
      error: '[settings] deleteSetting failed',
    });
  });

  it('화이트리스트는 Toss 키 3종을 포함하고 각 키에 env 폴백 이름이 있다', () => {
    expect(isDeletableSettingKey('toss_client_key')).toBe(true);
    expect(isDeletableSettingKey('toss_secret_key')).toBe(true);
    expect(isDeletableSettingKey('toss_webhook_secret')).toBe(true);
    for (const envName of Object.values(DELETABLE_SETTING_ENV_FALLBACK)) {
      expect(envName).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe('parseSettingsTab — 딥링크', () => {
  it('알려진 탭은 그대로, 그 외·미지정은 payment', () => {
    expect(parseSettingsTab('notify')).toBe('notify');
    expect(parseSettingsTab('legal')).toBe('legal');
    expect(parseSettingsTab('evil')).toBe('payment');
    expect(parseSettingsTab(undefined)).toBe('payment');
  });
});

describe('saveSettingsAction — 저장 화이트리스트', () => {
  it('허용 키는 저장하고 빈 값은 건너뛴다', async () => {
    await expect(
      saveSettingsAction({ admin_email: ' ops@example.com ', mail_from: '' }),
    ).resolves.toEqual({ ok: true });
    expect(setSettingMock).toHaveBeenCalledTimes(1);
    expect(setSettingMock).toHaveBeenCalledWith('admin_email', 'ops@example.com');
  });

  it.each(['unknown_key', 'toString', '__proto__', 'points_rate', ''])(
    '허용되지 않은 키 "%s" 가 섞이면 아무것도 저장하지 않는다',
    async (key) => {
      await expect(
        saveSettingsAction({ admin_email: 'ops@example.com', [key]: 'x' }),
      ).resolves.toEqual({ ok: false, error: '저장할 수 없는 설정입니다.' });
      expect(setSettingMock).not.toHaveBeenCalled();
    },
  );

  it('길이 상한을 넘는 값이 섞이면 아무것도 저장하지 않는다', async () => {
    const result = await saveSettingsAction({
      admin_email: 'ops@example.com',
      company_email: 'a'.repeat(SETTING_VALUE_MAX_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it('법적 고지 값을 저장하면 법적 고지 캐시를 무효화한다', async () => {
    await expect(saveSettingsAction({ legal_draft_notice_hidden: 'true' })).resolves.toEqual({
      ok: true,
    });
    expect(updateTagMock).toHaveBeenCalledWith('legal-settings');
  });

  it.each([null, [], 'x'])('객체가 아닌 입력 %j → 거부, 미저장', async (input) => {
    await expect(
      saveSettingsAction(input as unknown as Record<string, string>),
    ).resolves.toEqual({ ok: false, error: '잘못된 요청입니다.' });
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it('비관리자는 저장할 수 없다', async () => {
    requireAdminMock.mockRejectedValue(new Error('FORBIDDEN'));
    await expect(saveSettingsAction({ admin_email: 'x@example.com' })).resolves.toEqual({
      ok: false,
      error: '관리자 권한이 필요합니다.',
    });
    expect(setSettingMock).not.toHaveBeenCalled();
  });

  it('저장 화이트리스트는 법적 고지 키 전부를 포함한다', () => {
    for (const key of RESETTABLE_LEGAL_SETTING_KEYS) {
      expect(SETTABLE_SETTING_KEYS).toContain(key);
    }
  });
});
