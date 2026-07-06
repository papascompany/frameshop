'use client';

/**
 * 확장형(멀티포토) 주문 라인 목록 — FS-P1-03 (ADR-025).
 *
 * StudioClient 가 kind:'extended' 일 때 기존 "담은 사진" 트레이를 대체 렌더한다
 * (베이직 회귀 0 — basic 은 기존 트레이 그대로). 라인 카드마다 사이즈/방향
 * 셀렉트(updateLineOptions), 수량 ±, 라인 소계(lineUnitPrice), 복제/삭제,
 * 비활성 조합 경고(useLineAvailability)를 제공하고, "전체 같은 옵션 적용"
 * (applyOptionsToAllLines — 현재 옵션 패널 값 기준)을 헤더에 노출한다.
 *
 * 재크롭 배지: 라인의 크롭은 담기 시점 기하(사이즈×방향)로 베이크됐다. 이후
 * 사이즈/방향이 바뀐 라인은 표시 이미지(previewUrl)는 유지되지만 인쇄 비율이
 * 달라지므로 '재편집 권장' 배지 + 원본 재활성화 버튼을 띄운다. 베이스라인
 * (베이크 기하)은 "첫 기하 변경 직전 값"을 React state 로 동결한다 — 라인이
 * 밖에서 생길 때(담기/복원/복제)는 항상 현재 기하 == 베이크 기하이므로, 이
 * 컴포넌트의 이벤트 핸들러에서만 기록하면 충분하다(렌더 중 ref 접근 금지 —
 * react-hooks v7 refs 규칙 준수). 컴포넌트 로컬 state 라 새로고침 후에는
 * 초기화된다(드래프트에 베이크 기하 필드가 없는 P1 한계, 타입 FROZEN).
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  lineUnitPrice,
  useEditorStore,
  useEditorTotals,
  useLineAvailability,
  type FrameOrientation,
} from '@/store/editor';
import type { EditorPhotoEntry } from '@/types/editor';
import type { OptionMatrix } from '@/types/product';

type BakedGeometry = { sizeCode: string; orientation: FrameOrientation };

/** 기하 변경 여부 — 베이스라인 없는 라인(담기 후 무변경)은 false. */
function geometryChanged(
  baseline: BakedGeometry | undefined,
  sizeCode: string,
  orientation: FrameOrientation,
): boolean {
  return (
    baseline !== undefined &&
    (sizeCode !== baseline.sizeCode || orientation !== baseline.orientation)
  );
}

type Props = {
  options: OptionMatrix;
  /** '다시 크롭하기' — 라인의 원본 사진을 캔버스에 재활성화(라인은 유지). */
  onReactivate: (entry: EditorPhotoEntry) => void;
  /**
   * P1-002 (FS-P1-final): 재크롭 필요(기하 변경) 라인 수 보고 — 부모(StudioClient)
   * 가 묶음 담기를 차단하고 사유를 표시한다. 베이스라인(bakedGeom)이 이 컴포넌트
   * 로컬 state 라서 새로고침/드래프트 복원 후에는 판정이 초기화되는 한계는
   * 그대로다(근본 해결 = 베이크 기하의 드래프트 영속화 — 타입 FROZEN, P2 백로그).
   */
  onNeedsRecropChange?: (count: number) => void;
};

export function LineList({ options, onReactivate, onNeedsRecropChange }: Props) {
  const t = useTranslations('studio');
  const entries = useEditorStore((s) => s.entries);
  const selected = useEditorStore((s) => s.selectedOptions);
  const globalOrientation = useEditorStore((s) => s.orientation);
  const duplicateLine = useEditorStore((s) => s.duplicateLine);
  const applyOptionsToAllLines = useEditorStore((s) => s.applyOptionsToAllLines);
  const { totalQuantity } = useEditorTotals();

  // 라인별 베이크 기하(첫 기하 변경 직전 값). 이벤트 핸들러에서만 기록.
  const [bakedGeom, setBakedGeom] = useState<ReadonlyMap<string, BakedGeometry>>(
    () => new Map(),
  );

  // P1-002: 현재 기하 ≠ 베이크 기하인 라인 수. LineCard 의 needsRecrop 배지와
  // 같은 판정(geometryChanged)을 목록 단위로 합산해 부모에 보고한다.
  const needsRecropCount = entries.reduce((n, e) => {
    const effSize = (e.selectedOptions ?? selected).sizeCode;
    const effOrientation = e.orientation ?? globalOrientation;
    return geometryChanged(bakedGeom.get(e.entryId), effSize, effOrientation)
      ? n + 1
      : n;
  }, 0);

  useEffect(() => {
    onNeedsRecropChange?.(needsRecropCount);
  }, [needsRecropCount, onNeedsRecropChange]);
  // 트레이 비움/모드 전환으로 언마운트되면 차단을 해제한다.
  useEffect(() => () => onNeedsRecropChange?.(0), [onNeedsRecropChange]);

  /** 기하 변경 직전 1회 — 라인의 현재(=베이크) 기하를 동결한다. */
  function recordBaseline(entryId: string, current: BakedGeometry): void {
    setBakedGeom((prev) => {
      if (prev.has(entryId)) return prev;
      const next = new Map(prev);
      next.set(entryId, current);
      return next;
    });
  }

  function handleApplyAll(): void {
    // 일괄 적용도 기하 변경이 될 수 있다 — 베이스라인 없는 라인의 현재 기하를
    // 먼저 동결한 뒤 적용(방향은 라인별 유지 — 스토어 계약).
    const st = useEditorStore.getState();
    setBakedGeom((prev) => {
      const next = new Map(prev);
      for (const e of st.entries) {
        if (!next.has(e.entryId)) {
          next.set(e.entryId, {
            sizeCode: (e.selectedOptions ?? st.selectedOptions).sizeCode,
            orientation: e.orientation ?? st.orientation,
          });
        }
      }
      return next;
    });
    applyOptionsToAllLines(selected);
  }

  function handleDuplicate(entryId: string): void {
    duplicateLine(entryId);
    // 복제본은 원본의 베이크 기하를 물려받는다(같은 베이크 크롭 공유).
    const all = useEditorStore.getState().entries;
    const i = all.findIndex((e) => e.entryId === entryId);
    const copy = i === -1 ? undefined : all[i + 1];
    if (!copy) return;
    setBakedGeom((prev) => {
      const baseline = prev.get(entryId);
      if (!baseline) return prev;
      const next = new Map(prev);
      next.set(copy.entryId, baseline);
      return next;
    });
  }

  return (
    <div className="mt-6" data-testid="line-list">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium">
          {t('multiLines')}{' '}
          <span className="text-mute">
            ({entries.length} · {t('multiTotalQuantity', { count: totalQuantity })})
          </span>
        </p>
        {entries.length > 1 ? (
          <button
            type="button"
            data-testid="apply-all"
            className="shrink-0 text-xs underline text-mute hover:text-foreground"
            onClick={handleApplyAll}
          >
            {t('multiApplyAll')}
          </button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <LineCard
            key={entry.entryId}
            entry={entry}
            options={options}
            baseline={bakedGeom.get(entry.entryId)}
            onRecordBaseline={recordBaseline}
            onReactivate={onReactivate}
            onDuplicate={handleDuplicate}
          />
        ))}
      </ul>
    </div>
  );
}

// ── 라인 카드 ────────────────────────────────────────────────────────────────

function LineCard({
  entry,
  options,
  baseline,
  onRecordBaseline,
  onReactivate,
  onDuplicate,
}: {
  entry: EditorPhotoEntry;
  options: OptionMatrix;
  /** 베이크 기하 — 기하가 한 번도 안 바뀐 라인은 undefined(배지 없음). */
  baseline: BakedGeometry | undefined;
  onRecordBaseline: (entryId: string, current: BakedGeometry) => void;
  onReactivate: (entry: EditorPhotoEntry) => void;
  onDuplicate: (entryId: string) => void;
}) {
  const t = useTranslations('studio');
  const selected = useEditorStore((s) => s.selectedOptions);
  const globalOrientation = useEditorStore((s) => s.orientation);
  const updateLineOptions = useEditorStore((s) => s.updateLineOptions);
  const removeEntry = useEditorStore((s) => s.removeEntry);
  const setEntryQuantity = useEditorStore((s) => s.setEntryQuantity);
  const available = useLineAvailability(entry.entryId);
  const unitPrice = useEditorStore((s) => lineUnitPrice(s, entry));

  // 스냅샷 없는 라인(basic 드래프트에서 복원)은 전역 옵션을 따른다(ADR-025).
  const effOpts = entry.selectedOptions ?? selected;
  const effOrientation: FrameOrientation = entry.orientation ?? globalOrientation;
  const needsRecrop = geometryChanged(baseline, effOpts.sizeCode, effOrientation);

  return (
    <li data-testid="line-card" className="border border-hairline rounded-md p-2">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={entry.previewUrl}
          alt=""
          className="w-14 h-14 object-cover rounded bg-soft-cloud shrink-0"
        />

        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {/* 사이즈 / 방향 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label={t('multiSize')}
              data-testid="line-size-select"
              className="h-8 rounded border border-hairline bg-canvas px-2 text-xs"
              value={effOpts.sizeCode}
              onChange={(e) => {
                onRecordBaseline(entry.entryId, {
                  sizeCode: effOpts.sizeCode,
                  orientation: effOrientation,
                });
                updateLineOptions(
                  entry.entryId,
                  { ...effOpts, sizeCode: e.target.value },
                  effOrientation,
                );
              }}
            >
              {options.sizes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              aria-label={t('multiOrientation')}
              data-testid="line-orientation-select"
              className="h-8 rounded border border-hairline bg-canvas px-2 text-xs"
              value={effOrientation}
              onChange={(e) => {
                onRecordBaseline(entry.entryId, {
                  sizeCode: effOpts.sizeCode,
                  orientation: effOrientation,
                });
                updateLineOptions(
                  entry.entryId,
                  effOpts,
                  e.target.value as FrameOrientation,
                );
              }}
            >
              <option value="portrait">{t('multiPortrait')}</option>
              <option value="landscape">{t('multiLandscape')}</option>
            </select>
          </div>

          {/* 수량 ± / 라인 소계 */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={t('multiQtyDecrease')}
              className="w-8 h-8 rounded border border-hairline grid place-items-center disabled:opacity-40"
              onClick={() => setEntryQuantity(entry.entryId, entry.quantity - 1)}
              disabled={entry.quantity <= 1}
            >
              −
            </button>
            <span className="w-8 text-center tabular-nums text-sm">
              {entry.quantity}
            </span>
            <button
              type="button"
              aria-label={t('multiQtyIncrease')}
              className="w-8 h-8 rounded border border-hairline grid place-items-center disabled:opacity-40"
              onClick={() => setEntryQuantity(entry.entryId, entry.quantity + 1)}
              disabled={entry.quantity >= 99}
            >
              ＋
            </button>
            <span
              className="ml-auto text-sm tabular-nums text-mute"
              data-testid="line-subtotal"
            >
              {(unitPrice * entry.quantity).toLocaleString('ko-KR')}원
            </span>
          </div>

          {/* 비활성 조합 경고 */}
          {!available ? (
            <p role="alert" className="caption-md text-red-600" data-testid="line-unavailable">
              {t('multiUnavailable')}
            </p>
          ) : null}

          {/* 재크롭 필요 배지 + 원본 재활성화 */}
          {needsRecrop ? (
            <p className="caption-md flex items-center gap-2" data-testid="recrop-badge">
              <span className="inline-flex items-center rounded-full bg-soft-cloud px-2 py-0.5 text-[11px] font-medium text-ink">
                {t('multiRecropBadge')}
              </span>
              <button
                type="button"
                data-testid="recrop-button"
                className="underline text-mute hover:text-foreground"
                onClick={() => onReactivate(entry)}
              >
                {t('multiRecrop')}
              </button>
            </p>
          ) : null}
        </div>

        {/* 복제 / 삭제 */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="line-duplicate"
            className="text-xs underline text-mute hover:text-foreground"
            onClick={() => onDuplicate(entry.entryId)}
          >
            {t('multiDuplicate')}
          </button>
          <button
            type="button"
            aria-label={t('multiDelete')}
            data-testid="line-delete"
            className="text-mute hover:text-foreground px-1"
            onClick={() => removeEntry(entry.entryId)}
          >
            ✕
          </button>
        </div>
      </div>
    </li>
  );
}
