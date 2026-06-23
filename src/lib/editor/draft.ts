/**
 * Editor session draft persistence (선결과제 3 — 확장형 세션 무결성).
 *
 * 확장형/다건 편집은 사진 업로드·크롭·사이즈 지정에 시간이 걸려, 새로고침·탭닫기·
 * 크래시·실수 이탈로 세션이 날아가면 작업 손실 + 이탈이 크다. 사진 본체는 이미
 * Supabase Storage 에 영속되므로, **가벼운 세션 상태(확정 트레이 + 옵션/방향)만**
 * localStorage 에 저장해 같은 편집 세션으로 돌아오면 복원한다.
 *
 * 무결성 핵심: 키를 `(sessionId, productId)` 로 잡는다. `sessionId` 는 스튜디오
 * 페이지에서 `user.id ?? 게스트쿠키(fs-guest-sid) ?? orderId` 로 해석된 값이라
 * 새로고침·재진입에도 안정적이다. 따라서 복원된 트레이의 사진들은 동일 세션 소유로
 * 남아 결제 시 photo-ownership 검증을 그대로 통과한다(랜덤 orderId 로 키를 잡으면
 * 세션이 바뀌어 소유권 검증이 깨진다 — 그래서 sessionId 기준으로 고정).
 *
 * 클라이언트 전용(localStorage). SSR/노드 환경에서는 전부 no-op.
 *
 * 서버측 드래프트(교차기기·공유 링크 복원)는 P2+ 로 분리한다(마이그레이션 필요,
 * 무결성에는 불필요).
 */

import type { SelectedOptions } from '@/types/product';
import type { EditorPhotoEntry } from '@/types/editor';

/** Bump when the persisted shape changes incompatibly (old drafts auto-discarded). */
export const EDITOR_DRAFT_KEY_PREFIX = 'frameshop.editor.draft.v1';

/**
 * Drafts older than this are discarded on load. The persisted preview/photo URLs
 * are short-lived signed Storage URLs; resurrecting a week-old draft would show
 * broken images, so we treat stale drafts as gone.
 */
export const EDITOR_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type EditorDraft = {
  version: 1;
  /** ISO timestamp of the last save — drives TTL expiry. */
  savedAt: string;
  productId: string;
  selectedOptions: SelectedOptions;
  selectedVariantId: string | null;
  orientation: 'portrait' | 'landscape';
  entries: EditorPhotoEntry[];
};

export function editorDraftKey(sessionId: string, productId: string): string {
  return `${EDITOR_DRAFT_KEY_PREFIX}:${sessionId}:${productId}`;
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * Persist the current editor session for `(sessionId, productId)`. Saving an
 * empty tray clears the draft instead (nothing worth restoring). Best-effort —
 * never throws (quota/serialisation errors are swallowed).
 */
export function saveEditorDraft(
  sessionId: string,
  productId: string,
  snapshot: Omit<EditorDraft, 'version' | 'savedAt' | 'productId'>,
): void {
  if (!hasLocalStorage() || !sessionId || !productId) return;
  try {
    if (!snapshot.entries || snapshot.entries.length === 0) {
      window.localStorage.removeItem(editorDraftKey(sessionId, productId));
      return;
    }
    const draft: EditorDraft = {
      version: 1,
      savedAt: new Date().toISOString(),
      productId,
      selectedOptions: snapshot.selectedOptions,
      selectedVariantId: snapshot.selectedVariantId,
      orientation: snapshot.orientation,
      entries: snapshot.entries,
    };
    window.localStorage.setItem(
      editorDraftKey(sessionId, productId),
      JSON.stringify(draft),
    );
  } catch {
    // Quota exceeded / serialisation issue — drop silently. The session still
    // works in-memory; persistence is best-effort.
  }
}

/**
 * Load a previously saved draft for `(sessionId, productId)`. Returns null when
 * absent, expired (TTL), or structurally invalid (discarded — corruption never
 * blocks a fresh session). The caller decides whether/how to restore.
 */
export function loadEditorDraft(
  sessionId: string,
  productId: string,
): EditorDraft | null {
  if (!hasLocalStorage() || !sessionId || !productId) return null;
  const key = editorDraftKey(sessionId, productId);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemove(key);
    return null;
  }

  if (!isValidDraft(parsed, productId)) {
    safeRemove(key);
    return null;
  }

  // TTL expiry — stale drafts likely reference expired signed URLs.
  const savedMs = Date.parse(parsed.savedAt);
  if (!Number.isFinite(savedMs) || Date.now() - savedMs > EDITOR_DRAFT_TTL_MS) {
    safeRemove(key);
    return null;
  }

  return parsed;
}

export function clearEditorDraft(sessionId: string, productId: string): void {
  if (!hasLocalStorage() || !sessionId || !productId) return;
  safeRemove(editorDraftKey(sessionId, productId));
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Structural guard. Intentionally lenient (our own data; only guards against
 * corruption / schema drift), but verifies the load-bearing fields and that the
 * draft belongs to the requested product.
 */
function isValidDraft(value: unknown, productId: string): value is EditorDraft {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  if (d.version !== 1) return false;
  if (typeof d.savedAt !== 'string') return false;
  if (d.productId !== productId) return false;
  if (d.orientation !== 'portrait' && d.orientation !== 'landscape') return false;
  if (!d.selectedOptions || typeof d.selectedOptions !== 'object') return false;
  if (!Array.isArray(d.entries)) return false;
  for (const e of d.entries) {
    if (typeof e !== 'object' || e === null) return false;
    const entry = e as Record<string, unknown>;
    if (typeof entry.entryId !== 'string') return false;
    if (typeof entry.previewUrl !== 'string') return false;
    if (typeof entry.quantity !== 'number') return false;
    if (typeof entry.photo !== 'object' || entry.photo === null) return false;
    const photo = entry.photo as Record<string, unknown>;
    if (typeof photo.id !== 'string' || typeof photo.originalUrl !== 'string') return false;
  }
  return true;
}
