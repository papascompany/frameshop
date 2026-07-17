'use client';

/**
 * 세트 템플릿(set_templates) 패널 — 목록 + 생성/수정 폼 + 미니맵 프리뷰 (FS-X-03, 탭5).
 *
 * - 슬롯 행 편집: sizeCode(옵션 매트릭스 사이즈) / orientation / slotPos mm 4필드
 *   (FramesClient inner_rect fieldset 패턴 — 단위만 정규화 0~1 대신 mm).
 * - 좌표(x,y)를 비우면 그리드모드 슬롯(slotPos 없음), 채우면 벽모드 슬롯.
 *   w/h 를 비우면 선택한 사이즈의 실측(mm, 방향 반영)으로 자동 채운다.
 * - 프리뷰: WallCanvas 읽기전용 미니맵(dynamic ssr:false — ADR-015).
 */

import { useMemo, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { orientedSizeMm } from '@/lib/wall/scale';
import type { FrameAsset, ProductVariant } from '@/types/product';
import type { Orientation } from '@/types/project';
import type { SetTemplate, SetTemplateSlot } from '@/types/set';
import type {
  SlotFrameInfo,
  SlotSizeInfo,
} from '@/modules/wall/set-template-adapter';
import {
  deleteSetTemplateAction,
  toggleSetTemplateActiveAction,
  upsertSetTemplateAction,
} from './actions';

const SetTemplatePreview = dynamic(
  () => import('@/modules/wall/SetTemplatePreview'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full aspect-[3/2] bg-surface-muted grid place-items-center text-sm text-muted-fg">
        미리보기를 불러오는 중…
      </div>
    ),
  },
);

type Props = {
  productId: string;
  templates: SetTemplate[];
  variants: ProductVariant[];
  frames: FrameAsset[];
};

type SlotRow = {
  sizeCode: string;
  orientation: Orientation;
  x: string;
  y: string;
  w: string;
  h: string;
};

type FormState = {
  id?: string;
  name: string;
  wallWMm: string;
  wallHMm: string;
  isActive: boolean;
  rows: SlotRow[];
};

function emptyRow(defaultSizeCode: string): SlotRow {
  return { sizeCode: defaultSizeCode, orientation: 'portrait', x: '', y: '', w: '', h: '' };
}

function emptyForm(defaultSizeCode: string): FormState {
  return {
    name: '',
    wallWMm: '',
    wallHMm: '',
    isActive: true,
    rows: [emptyRow(defaultSizeCode)],
  };
}

function templateToForm(t: SetTemplate): FormState {
  return {
    id: t.id as string,
    name: t.name,
    wallWMm: t.wallWMm != null ? String(t.wallWMm) : '',
    wallHMm: t.wallHMm != null ? String(t.wallHMm) : '',
    isActive: t.isActive,
    rows: t.slots.map((s) => ({
      sizeCode: s.sizeCode,
      orientation: s.orientation,
      x: s.slotPos ? String(s.slotPos.xMm) : '',
      y: s.slotPos ? String(s.slotPos.yMm) : '',
      w: s.slotPos ? String(s.slotPos.wMm) : '',
      h: s.slotPos ? String(s.slotPos.hMm) : '',
    })),
  };
}

/**
 * 폼 행 → SetTemplateSlot[]. x·y 둘 다 입력된 행만 slotPos 를 갖는다(벽모드 슬롯).
 * w/h 미입력 시 선택 사이즈의 방향 반영 실측(mm)으로 채운다.
 * 숫자가 아닌 값이 섞이면 null 을 돌려 폼 에러로 처리한다.
 */
function buildSlots(
  rows: SlotRow[],
  sizeByCode: Map<string, SlotSizeInfo>,
): SetTemplateSlot[] | null {
  const slots: SetTemplateSlot[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const hasX = row.x.trim() !== '';
    const hasY = row.y.trim() !== '';
    if (hasX !== hasY) return null; // 좌표는 쌍으로.

    let slotPos: SetTemplateSlot['slotPos'];
    if (hasX && hasY) {
      const size = sizeByCode.get(row.sizeCode);
      const oriented = size
        ? orientedSizeMm(size.widthMm, size.heightMm, row.orientation)
        : null;
      const x = Number(row.x);
      const y = Number(row.y);
      const w = row.w.trim() !== '' ? Number(row.w) : oriented?.wMm;
      const h = row.h.trim() !== '' ? Number(row.h) : oriented?.hMm;
      if (
        w == null ||
        h == null ||
        [x, y, w, h].some((n) => !Number.isFinite(n)) ||
        x < 0 ||
        y < 0 ||
        w <= 0 ||
        h <= 0
      ) {
        return null;
      }
      slotPos = { xMm: x, yMm: y, wMm: w, hMm: h };
    }

    slots.push({
      slotIndex: i,
      sizeCode: row.sizeCode,
      orientation: row.orientation,
      ...(slotPos ? { slotPos } : {}),
    });
  }
  return slots;
}

export function SetTemplatesPanel({ productId, templates, variants, frames }: Props) {
  const router = useRouter();

  // 옵션 매트릭스 사이즈(중복 제거) — 슬롯 select 어휘 + 프리뷰 실측 소스.
  const sizes = useMemo<SlotSizeInfo[]>(() => {
    const seen = new Set<string>();
    const out: SlotSizeInfo[] = [];
    for (const v of variants) {
      if (seen.has(v.sizeCode)) continue;
      seen.add(v.sizeCode);
      out.push({
        sizeCode: v.sizeCode,
        sizeLabel: v.sizeLabel,
        widthMm: v.widthMm,
        heightMm: v.heightMm,
        variantId: v.id as string,
      });
    }
    return out;
  }, [variants]);
  const sizeByCode = useMemo(
    () => new Map(sizes.map((s) => [s.sizeCode, s])),
    [sizes],
  );
  const defaultSizeCode = sizes[0]?.sizeCode ?? '';

  const frame = useMemo<SlotFrameInfo | null>(() => {
    const f = frames[0];
    return f
      ? { frameUrl: f.pngUrl, colorCode: f.colorCode, colorLabel: f.colorLabel }
      : null;
  }, [frames]);

  const [form, setForm] = useState<FormState>(() => emptyForm(defaultSizeCode));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sizeOptions = sizes.map((s) => ({
    value: s.sizeCode,
    label: `${s.sizeCode} (${s.sizeLabel} · ${s.widthMm}×${s.heightMm}mm)`,
  }));

  // 라이브 프리뷰 입력(유효 행만 — 입력 도중의 깨진 행은 조용히 제외).
  const previewSlots = useMemo<SetTemplateSlot[]>(() => {
    return buildSlots(form.rows, sizeByCode) ?? [];
  }, [form.rows, sizeByCode]);
  const previewWallW =
    form.wallWMm.trim() !== '' && Number.isFinite(Number(form.wallWMm))
      ? Number(form.wallWMm)
      : null;
  const previewWallH =
    form.wallHMm.trim() !== '' && Number.isFinite(Number(form.wallHMm))
      ? Number(form.wallHMm)
      : null;

  function updateRow(index: number, patch: Partial<SlotRow>) {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  }

  function addRow() {
    setForm((prev) => ({ ...prev, rows: [...prev.rows, emptyRow(defaultSizeCode)] }));
  }

  function removeRow(index: number) {
    setForm((prev) => ({ ...prev, rows: prev.rows.filter((_, i) => i !== index) }));
  }

  function startCreate() {
    setForm(emptyForm(defaultSizeCode));
    setError(null);
  }

  function startEdit(t: SetTemplate) {
    setForm(templateToForm(t));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (sizes.length === 0) {
      setError('옵션 탭에서 변형(사이즈)을 먼저 등록하세요.');
      return;
    }
    if (form.rows.length === 0) {
      setError('슬롯을 1개 이상 추가하세요.');
      return;
    }
    const slots = buildSlots(form.rows, sizeByCode);
    if (!slots) {
      setError('슬롯 좌표를 확인하세요 — x·y 는 쌍으로 입력하고, 값은 0 이상(w/h 는 1 이상)의 숫자여야 합니다.');
      return;
    }
    const hasWallW = form.wallWMm.trim() !== '';
    const hasWallH = form.wallHMm.trim() !== '';
    if (hasWallW !== hasWallH) {
      setError('벽 치수는 가로/세로(mm)를 함께 입력하거나 모두 비워야 합니다.');
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      if (form.id) fd.append('id', form.id);
      fd.append('productId', productId);
      fd.append('name', form.name);
      fd.append('slots', JSON.stringify(slots));
      if (hasWallW) fd.append('wallWMm', form.wallWMm);
      if (hasWallH) fd.append('wallHMm', form.wallHMm);
      fd.append('isActive', String(form.isActive));

      const result = await upsertSetTemplateAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm(emptyForm(defaultSizeCode));
      router.refresh();
    });
  }

  function handleToggleActive(t: SetTemplate) {
    startTransition(async () => {
      const fd = new FormData();
      fd.append('id', t.id as string);
      fd.append('productId', productId);
      fd.append('active', String(!t.isActive));
      const result = await toggleSetTemplateActiveAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete(t: SetTemplate) {
    if (!confirm(`"${t.name}" 세트 템플릿을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append('id', t.id as string);
      fd.append('productId', productId);
      const result = await deleteSetTemplateAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (form.id === (t.id as string)) setForm(emptyForm(defaultSizeCode));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- 목록 ---- */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b border-border whitespace-nowrap">
              <tr>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2 text-right">슬롯</th>
                <th className="px-3 py-2">벽 (mm)</th>
                <th className="px-3 py-2">활성</th>
                <th className="px-3 py-2 text-right">동작</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-fg">
                    등록된 세트 템플릿이 없습니다. 아래 폼에서 생성하세요.
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id as string} className="border-b border-border whitespace-nowrap">
                    <td className="px-3 py-2 font-medium">{t.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.slots.length}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {t.wallWMm != null && t.wallHMm != null
                        ? `${t.wallWMm} × ${t.wallHMm}`
                        : '그리드'}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(t)}
                        disabled={pending}
                        className={cn(
                          'text-xs px-2.5 py-1 rounded-full font-semibold transition-colors',
                          t.isActive
                            ? 'bg-success/10 text-success hover:bg-success/20'
                            : 'bg-surface-muted text-muted-fg',
                        )}
                      >
                        {t.isActive ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(t)} disabled={pending}>
                        편집
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(t)}
                        disabled={pending}
                        className="text-danger hover:text-danger"
                      >
                        삭제
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---- 생성/수정 폼 + 프리뷰 ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="md">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">
                {form.id ? '세트 템플릿 수정' : '새 세트 템플릿'}
              </h3>
              {form.id ? (
                <Button size="sm" variant="ghost" onClick={startCreate} disabled={pending}>
                  새로 만들기
                </Button>
              ) : null}
            </div>

            <Input
              label="이름"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="예: 갤러리월 3종 세트"
              required
              maxLength={60}
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="벽 가로 (mm)"
                type="number"
                min={1}
                value={form.wallWMm}
                onChange={(e) => setForm({ ...form, wallWMm: e.target.value })}
                hint="비우면 그리드모드"
              />
              <Input
                label="벽 세로 (mm)"
                type="number"
                min={1}
                value={form.wallHMm}
                onChange={(e) => setForm({ ...form, wallHMm: e.target.value })}
              />
            </div>

            {/* ---- 슬롯 행 편집 (inner_rect fieldset 패턴 — 단위 mm) ---- */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">
                슬롯 구성 <span className="text-xs text-muted-fg">(x·y 를 비우면 그리드 배치)</span>
              </legend>
              {form.rows.map((row, i) => (
                <div key={i} className="border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-fg">슬롯 {i}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeRow(i)}
                      disabled={pending || form.rows.length <= 1}
                    >
                      행 삭제
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Select
                      label="사이즈"
                      value={row.sizeCode}
                      onChange={(e) => updateRow(i, { sizeCode: e.target.value })}
                      options={sizeOptions}
                      placeholder={sizeOptions.length === 0 ? '변형을 먼저 등록하세요' : undefined}
                      disabled={sizeOptions.length === 0}
                    />
                    <Select
                      label="방향"
                      value={row.orientation}
                      onChange={(e) =>
                        updateRow(i, { orientation: e.target.value as Orientation })
                      }
                      options={[
                        { value: 'portrait', label: '세로 (portrait)' },
                        { value: 'landscape', label: '가로 (landscape)' },
                      ]}
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <Input
                      label="x (mm)"
                      type="number"
                      min={0}
                      value={row.x}
                      onChange={(e) => updateRow(i, { x: e.target.value })}
                    />
                    <Input
                      label="y (mm)"
                      type="number"
                      min={0}
                      value={row.y}
                      onChange={(e) => updateRow(i, { y: e.target.value })}
                    />
                    <Input
                      label="w (mm)"
                      type="number"
                      min={1}
                      value={row.w}
                      onChange={(e) => updateRow(i, { w: e.target.value })}
                    />
                    <Input
                      label="h (mm)"
                      type="number"
                      min={1}
                      value={row.h}
                      onChange={(e) => updateRow(i, { h: e.target.value })}
                    />
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={addRow}
                disabled={pending || form.rows.length >= 50}
                data-testid="set-template-add-slot-btn"
              >
                + 슬롯 추가
              </Button>
            </fieldset>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4"
              />
              <span>활성 (is_active)</span>
            </label>

            {error ? (
              <div role="alert" className="text-sm text-danger border border-danger px-3 py-2">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              loading={pending}
              disabled={pending}
              data-testid="set-template-save-btn"
            >
              {form.id ? '템플릿 저장' : '템플릿 생성'}
            </Button>
          </form>
        </Card>

        {/* ---- 미니맵 프리뷰 (읽기전용 WallCanvas) ---- */}
        <Card padding="md" className="space-y-2">
          <h3 className="text-base font-semibold">미니맵 미리보기</h3>
          <p className="text-xs text-muted-fg">
            실측 비율 미리보기입니다 (드래그 불가 — 좌표는 좌측 폼에서 수정).
          </p>
          <SetTemplatePreview
            productId={productId}
            slots={previewSlots}
            wallWMm={previewWallW}
            wallHMm={previewWallH}
            sizes={sizes}
            frame={frame}
          />
        </Card>
      </div>
    </div>
  );
}
