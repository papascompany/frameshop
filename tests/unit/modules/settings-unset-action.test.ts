/**
 * admin/settings — 설정값 삭제(unset) 서버 액션.
 *
 * 고정하는 계약:
 *  1. requireAdmin 실패(비로그인·비관리자) → 거부, deleteSetting 미호출.
 *  2. 화이트리스트(DELETABLE_SETTING_ENV_FALLBACK) 밖의 키 → 거부, 미호출.
 *     프로토타입 속성명(`toString`·`__proto__`)도 허용되지 않는다.
 *  3. 허용 키 → deleteSetting(key) 위임, DB 오류는 메시지로 반환.
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
}));

vi.mock('next/cache', () => ({
  updateTag: vi.fn(),
}));

import { deleteSettingAction } from '@/app/admin/settings/actions';
import {
  DELETABLE_SETTING_ENV_FALLBACK,
  isDeletableSettingKey,
  parseSettingsTab,
} from '@/app/admin/settings/setting-keys';
import { requireAdmin } from '@/lib/db/admin';
import { deleteSetting } from '@/lib/db/settings';

const requireAdminMock = vi.mocked(requireAdmin);
const deleteSettingMock = vi.mocked(deleteSetting);

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
  it.each(['admin_email', 'company_email', 'legal_draft_notice_hidden', 'unknown_key', 'toString', '__proto__', ''])(
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
