'use server';

import { updateTag } from 'next/cache';
import { requireAdmin } from '@/lib/db/admin';
import { setSetting } from '@/lib/db/settings';
import { LEGAL_SETTINGS_TAG } from '@/lib/legal/company-settings';

type SaveResult = { ok: boolean; error?: string };

/**
 * 설정 키-값 묶음 저장.
 * 빈 값 키는 저장하지 않음(기존 값 유지 — 마스킹 UI 특성상 빈 입력 = 변경 없음).
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
    let touchedLegal = false;
    for (const [key, value] of Object.entries(settings)) {
      if (value.trim() !== '') {
        await setSetting(key, value.trim());
        if (key.startsWith('company_') || key.startsWith('legal_')) {
          touchedLegal = true;
        }
      }
    }
    // 법적 고지 값은 Footer(전 페이지)·/terms·/privacy 가 캐시해서 읽는다 —
    // 저장 즉시 반영되도록 태그를 무효화한다(Next 16: 서버 액션은 updateTag).
    if (touchedLegal) {
      updateTag(LEGAL_SETTINGS_TAG);
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return { ok: false, error: message };
  }
}
