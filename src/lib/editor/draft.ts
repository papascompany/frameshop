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
 * ADR-025 (드래프트 v2): 확장형 P1 이 `kind`(모드) + `photoPool`(사진풀) +
 * 라인 단위 옵션(entries[].selectedOptions/orientation)을 드래프트에 추가했다.
 * **스키마 버전은 payload 의 `version` 필드로 판별**하고, v1 payload 는 로드 시
 * v2 로 자동 승격한다(kind:'basic', photoPool 없음 — 손실 0).
 *
 * 클라이언트 전용(localStorage). SSR/노드 환경에서는 전부 no-op.
 *
 * 서버측 드래프트(교차기기·공유 링크 복원)는 P2+ 로 분리한다(마이그레이션 필요,
 * 무결성에는 불필요 — ADR-022 결정 유지).
 */

import type { SelectedOptions } from '@/types/product';
import type { EditorKind, EditorPhotoEntry } from '@/types/editor';
import type { ProjectPhotoRef } from '@/types/project';

/**
 * Storage key prefix. ⚠️ 키 문자열에 박힌 `v1` 은 **의도적으로 유지**한다(ADR-025):
 * 키를 v2 로 바꾸면 기존 사용자의 v1 드래프트가 전부 고아가 되어 소실된다.
 * 스키마 버전은 payload 의 `version` 필드가 담당한다(v1 → 로드 시 v2 자동 승격).
 */
export const EDITOR_DRAFT_KEY_PREFIX = 'frameshop.editor.draft.v1';

/**
 * Drafts older than this are discarded on load. The persisted preview/photo URLs
 * are short-lived signed Storage URLs; resurrecting a week-old draft would show
 * broken images, so we treat stale drafts as gone.
 */
export const EDITOR_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Legacy persisted shape (ADR-022, ~P0). 저장은 더 이상 하지 않지만 로드는 계속
 * 받아들인다 — `migrateEditorDraftV1` 이 무손실로 v2 로 승격한다.
 */
export type EditorDraftV1 = {
  version: 1;
  /** ISO timestamp of the last save — drives TTL expiry. */
  savedAt: string;
  productId: string;
  selectedOptions: SelectedOptions;
  selectedVariantId: string | null;
  orientation: 'portrait' | 'landscape';
  entries: EditorPhotoEntry[];
};

/**
 * Current persisted shape (v2, ADR-025 — 확장형 P1).
 * v1 과의 차이: `kind`(모드), `photoPool?`(확장형 사진풀), entries 라인이 옵셔널
 * `selectedOptions`/`orientation` 을 가질 수 있음(타입은 EditorPhotoEntry 가 SSOT).
 */
export type EditorDraft = {
  version: 2;
  /** ISO timestamp of the last save — drives TTL expiry. */
  savedAt: string;
  productId: string;
  /** 'basic' = 현행 단품, 'extended' = 멀티포토 라인. v1 승격 드래프트는 'basic'. */
  kind: EditorKind;
  selectedOptions: SelectedOptions;
  selectedVariantId: string | null;
  orientation: 'portrait' | 'landscape';
  /** 확장형 사진풀(ADR-025). basic/v1 승격 드래프트에는 없음. */
  photoPool?: ProjectPhotoRef[];
  entries: EditorPhotoEntry[];
};

/**
 * `saveEditorDraft` 의 스냅샷 입력. `kind` 는 옵셔널(미지정 = 'basic') — 기존
 * 호출부(StudioClient 단품 경로)가 시그니처 변경 없이 그대로 컴파일된다.
 */
export type EditorDraftSnapshot = Omit<
  EditorDraft,
  'version' | 'savedAt' | 'productId' | 'kind'
> & {
  kind?: EditorKind;
};

/**
 * v1 → v2 무손실 승격(ADR-025). 순수 함수 — 모든 v1 필드를 그대로 보존하고
 * `kind:'basic'` 만 부여한다(photoPool 은 v1 에 개념이 없으므로 미설정).
 */
export function migrateEditorDraftV1(v1: EditorDraftV1): EditorDraft {
  return {
    version: 2,
    savedAt: v1.savedAt,
    productId: v1.productId,
    kind: 'basic',
    selectedOptions: v1.selectedOptions,
    selectedVariantId: v1.selectedVariantId,
    orientation: v1.orientation,
    entries: v1.entries,
  };
}

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
 * empty session clears the draft instead (nothing worth restoring) — "empty" =
 * 트레이(entries)와 사진풀(photoPool)이 모두 비어 있음(확장형은 라인 확정 전
 * 사진풀만 채운 상태도 복원 가치가 있다 — ADR-025). Best-effort — never throws
 * (quota/serialisation errors are swallowed). Always writes version 2.
 */
export function saveEditorDraft(
  sessionId: string,
  productId: string,
  snapshot: EditorDraftSnapshot,
): void {
  if (!hasLocalStorage() || !sessionId || !productId) return;
  try {
    const hasEntries = !!snapshot.entries && snapshot.entries.length > 0;
    const hasPool = !!snapshot.photoPool && snapshot.photoPool.length > 0;
    if (!hasEntries && !hasPool) {
      window.localStorage.removeItem(editorDraftKey(sessionId, productId));
      return;
    }
    const draft: EditorDraft = {
      version: 2,
      savedAt: new Date().toISOString(),
      productId,
      kind: snapshot.kind ?? 'basic',
      selectedOptions: snapshot.selectedOptions,
      selectedVariantId: snapshot.selectedVariantId,
      orientation: snapshot.orientation,
      entries: snapshot.entries,
      ...(hasPool ? { photoPool: snapshot.photoPool } : {}),
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
 * blocks a fresh session). v1 payloads are auto-promoted to v2 in-memory
 * (손실 0 — 저장소 재기록은 다음 save 가 담당). The caller decides whether/how
 * to restore. 반환은 항상 v2 (`EditorDraft`).
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

  if (!isValidStoredDraft(parsed, productId)) {
    safeRemove(key);
    return null;
  }

  // TTL expiry — stale drafts likely reference expired signed URLs.
  const savedMs = Date.parse(parsed.savedAt);
  if (!Number.isFinite(savedMs) || Date.now() - savedMs > EDITOR_DRAFT_TTL_MS) {
    safeRemove(key);
    return null;
  }

  return sanitizePhotoPoolUrls(
    parsed.version === 1 ? migrateEditorDraftV1(parsed) : parsed,
  );
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
 * Structural guard for the persisted union (v1 | v2). Intentionally lenient
 * (our own data; only guards against corruption / schema drift), but verifies
 * the load-bearing fields and that the draft belongs to the requested product.
 */
function isValidStoredDraft(
  value: unknown,
  productId: string,
): value is EditorDraftV1 | EditorDraft {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  if (d.version !== 1 && d.version !== 2) return false;
  if (typeof d.savedAt !== 'string') return false;
  if (d.productId !== productId) return false;
  if (d.orientation !== 'portrait' && d.orientation !== 'landscape') return false;
  if (!d.selectedOptions || typeof d.selectedOptions !== 'object') return false;
  if (!isValidEntries(d.entries)) return false;
  if (d.version === 2) {
    if (d.kind !== 'basic' && d.kind !== 'extended') return false;
    if (d.photoPool !== undefined && !isValidPhotoPool(d.photoPool)) return false;
  }
  return true;
}

function isValidEntries(value: unknown): value is EditorPhotoEntry[] {
  if (!Array.isArray(value)) return false;
  for (const e of value) {
    if (typeof e !== 'object' || e === null) return false;
    const entry = e as Record<string, unknown>;
    if (typeof entry.entryId !== 'string') return false;
    if (typeof entry.previewUrl !== 'string') return false;
    if (typeof entry.quantity !== 'number') return false;
    if (typeof entry.photo !== 'object' || entry.photo === null) return false;
    const photo = entry.photo as Record<string, unknown>;
    if (typeof photo.id !== 'string' || typeof photo.originalUrl !== 'string') return false;
    // ADR-025 라인 단위 옵션 — 있으면 형태 검증(없으면 basic 라인, 통과).
    if (
      entry.selectedOptions !== undefined &&
      (typeof entry.selectedOptions !== 'object' || entry.selectedOptions === null)
    ) {
      return false;
    }
    if (
      entry.orientation !== undefined &&
      entry.orientation !== 'portrait' &&
      entry.orientation !== 'landscape'
    ) {
      return false;
    }
  }
  return true;
}

function isValidPhotoPool(value: unknown): value is ProjectPhotoRef[] {
  if (!Array.isArray(value)) return false;
  for (const p of value) {
    if (typeof p !== 'object' || p === null) return false;
    const ref = p as Record<string, unknown>;
    if (typeof ref.photoId !== 'string') return false;
    if (typeof ref.previewUrl !== 'string') return false;
  }
  return true;
}

/**
 * P2 (FS-P1-security): localStorage 변조 드래프트의 previewUrl/originalUrl 이
 * `<img src>` 로 직행하는 데 대한 XSS 심층방어 — cartItemSchema 의 httpsUrl 과
 * 동일 원칙으로 `https://` 접두를 요구한다. 불일치 **항목만** 드랍하고 드래프트
 * 전체는 살린다(정상 항목의 복원 가치 보존 — 전체 폐기 아님).
 */
function isHttpsUrl(value: string): boolean {
  return value.startsWith('https://');
}

function sanitizePhotoPoolUrls(draft: EditorDraft): EditorDraft {
  if (!draft.photoPool || draft.photoPool.length === 0) return draft;
  const kept = draft.photoPool.filter(
    (ref) =>
      isHttpsUrl(ref.previewUrl) &&
      (ref.originalUrl === undefined || isHttpsUrl(ref.originalUrl)),
  );
  return kept.length === draft.photoPool.length
    ? draft
    : { ...draft, photoPool: kept };
}
