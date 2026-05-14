'use server';

import { requireAdmin } from '@/lib/db/admin';
import { setSetting } from '@/lib/db/settings';

type SaveResult = { ok: boolean; error?: string };

/**
 * 설정 키-값 묶음 저장.
 * 빈 값 키는 저장하지 않음.
 */
export async function saveSettingsAction(
  settings: Record<string, string>,
): Promise<SaveResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }

  try {
    for (const [key, value] of Object.entries(settings)) {
      if (value.trim() !== '') {
        await setSetting(key, value.trim());
      }
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return { ok: false, error: message };
  }
}
