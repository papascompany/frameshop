'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ShippingMethodConfig } from '@/types/shipping';
import { updateShippingMethodsAction } from './actions';

type RowState = {
  code: string;
  label: string;
  fee: string;
  freeThreshold: string;
  note: string;
  isActive: boolean;
  sortOrder: string;
  /** 제주 추가 배송비(030) — STANDARD 전용. */
  surchargeFeeJeju: string;
  /** 도서산간 추가 배송비(030) — STANDARD 전용. */
  surchargeFeeRemote: string;
};

function configToRow(m: ShippingMethodConfig): RowState {
  return {
    code: m.code,
    label: m.label,
    fee: String(m.fee),
    freeThreshold: m.freeThreshold !== null ? String(m.freeThreshold) : '',
    note: m.note ?? '',
    isActive: m.isActive,
    sortOrder: String(m.sortOrder),
    surchargeFeeJeju: String(m.surchargeFeeJeju ?? 0),
    surchargeFeeRemote: String(m.surchargeFeeRemote ?? 0),
  };
}

/** 빈 문자열/비수치 입력은 0 으로 — 서버 zod 는 정수만 받는다. */
function toInt(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function ShippingClient({ methods }: { methods: ShippingMethodConfig[] }) {
  const [rows, setRows] = useState<RowState[]>(methods.map(configToRow));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function updateRow(index: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSuccess(false);
    setError(null);
  }

  function handleSave() {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const payload = rows.map((r) => ({
        code: r.code,
        label: r.label,
        fee: Number(r.fee),
        freeThreshold: r.freeThreshold !== '' ? Number(r.freeThreshold) : null,
        note: r.note || null,
        isActive: r.isActive,
        sortOrder: Number(r.sortOrder),
        // STANDARD 외에는 0 강제 — zod refine(surcharge is STANDARD-only) 충족.
        surchargeFeeJeju: r.code === 'STANDARD' ? toInt(r.surchargeFeeJeju) : 0,
        surchargeFeeRemote:
          r.code === 'STANDARD' ? toInt(r.surchargeFeeRemote) : 0,
      }));
      const result = await updateShippingMethodsAction(payload);
      if (!result.ok) {
        setError(result.error);
      } else {
        setSuccess(true);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left border-b border-border bg-muted/40">
            <tr>
              <th className="px-3 py-2">코드</th>
              <th className="px-3 py-2">라벨</th>
              <th className="px-3 py-2">요금 (원)</th>
              <th className="px-3 py-2">무료 기준 (원)</th>
              <th className="px-3 py-2">제주 추가 (원)</th>
              <th className="px-3 py-2">도서산간 추가 (원)</th>
              <th className="px-3 py-2">비고</th>
              <th className="px-3 py-2 text-center">활성</th>
              <th className="px-3 py-2">정렬</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.code} className="border-b border-border">
                <td className="px-3 py-2 font-mono font-medium">{row.code}</td>
                <td className="px-3 py-2">
                  <Input
                    value={row.label}
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                    disabled={pending}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    value={row.fee}
                    onChange={(e) => updateRow(i, { fee: e.target.value })}
                    disabled={pending}
                  />
                </td>
                <td className="px-3 py-2">
                  {row.code === 'STANDARD' ? (
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={row.freeThreshold}
                      onChange={(e) => updateRow(i, { freeThreshold: e.target.value })}
                      placeholder="없음"
                      disabled={pending}
                    />
                  ) : (
                    <span className="text-muted-fg px-3">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.code === 'STANDARD' ? (
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={row.surchargeFeeJeju}
                      onChange={(e) =>
                        updateRow(i, { surchargeFeeJeju: e.target.value })
                      }
                      placeholder="0"
                      disabled={pending}
                    />
                  ) : (
                    <span className="text-muted-fg px-3">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.code === 'STANDARD' ? (
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={row.surchargeFeeRemote}
                      onChange={(e) =>
                        updateRow(i, { surchargeFeeRemote: e.target.value })
                      }
                      placeholder="0"
                      disabled={pending}
                    />
                  ) : (
                    <span className="text-muted-fg px-3">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={row.note}
                    onChange={(e) => updateRow(i, { note: e.target.value })}
                    placeholder="선택 사항"
                    disabled={pending}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    onChange={(e) => updateRow(i, { isActive: e.target.checked })}
                    disabled={pending}
                    className="w-4 h-4 rounded border-border cursor-pointer"
                  />
                </td>
                <td className="px-3 py-2 w-20">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={row.sortOrder}
                    onChange={(e) => updateRow(i, { sortOrder: e.target.value })}
                    disabled={pending}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4">
        <Button
          variant="primary"
          onClick={handleSave}
          loading={pending}
          disabled={pending}
        >
          저장
        </Button>
        {success && (
          <span className="text-sm text-success">저장되었습니다.</span>
        )}
        {error && (
          <span role="alert" className="text-sm text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
