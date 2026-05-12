'use client';

/**
 * Client UI for /admin/frames: 상품 선택 + frame_assets 표 + 추가/수정 다이얼로그.
 *
 * URL state: 상품 선택은 `?product=<uuid>` 로 라우터 푸시하여 SSR 새 fetch.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { FrameAsset, Product } from '@/types/product';
import { createOrUpdateFrameAction } from './actions';

type FormState = {
  id?: string;
  colorCode: string;
  colorLabel: string;
  pngUrl: string;
  previewUrl: string;
  ix: string;
  iy: string;
  iw: string;
  ih: string;
};

const EMPTY_FORM: FormState = {
  colorCode: '',
  colorLabel: '',
  pngUrl: '',
  previewUrl: '',
  ix: '0.1',
  iy: '0.1',
  iw: '0.8',
  ih: '0.8',
};

function frameToForm(f: FrameAsset): FormState {
  return {
    id: f.id as string,
    colorCode: f.colorCode,
    colorLabel: f.colorLabel,
    pngUrl: f.pngUrl,
    previewUrl: f.previewUrl ?? '',
    ix: String(f.innerRect.x),
    iy: String(f.innerRect.y),
    iw: String(f.innerRect.w),
    ih: String(f.innerRect.h),
  };
}

export function FramesClient({
  products,
  selectedProductId,
  frames,
}: {
  products: Product[];
  selectedProductId: string | null;
  frames: FrameAsset[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const productOptions = products.map((p) => ({ value: p.id as string, label: p.name }));

  function onProductChange(productId: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('product', productId);
    router.push(`/admin/frames?${params.toString()}`);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setOpen(true);
  }

  function openEdit(f: FrameAsset) {
    setForm(frameToForm(f));
    setError(null);
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedProductId) {
      setError('먼저 상품을 선택해 주세요.');
      return;
    }
    const ix = Number(form.ix);
    const iy = Number(form.iy);
    const iw = Number(form.iw);
    const ih = Number(form.ih);
    if ([ix, iy, iw, ih].some((n) => !Number.isFinite(n))) {
      setError('inner_rect 값은 숫자여야 합니다.');
      return;
    }
    if (ix < 0 || iy < 0 || iw <= 0 || ih <= 0) {
      setError('inner_rect 값은 0 이상이며 w/h 는 0보다 커야 합니다.');
      return;
    }
    if (ix + iw > 1 + 1e-6 || iy + ih > 1 + 1e-6) {
      setError('x + w ≤ 1, y + h ≤ 1 을 만족해야 합니다.');
      return;
    }

    startTransition(async () => {
      const payload = {
        productId: selectedProductId,
        colorCode: form.colorCode.trim(),
        colorLabel: form.colorLabel.trim(),
        pngUrl: form.pngUrl.trim(),
        previewUrl: form.previewUrl.trim() ? form.previewUrl.trim() : null,
        innerRect: { x: ix, y: iy, w: iw, h: ih },
        ...(form.id ? { id: form.id } : {}),
      };
      const result = await createOrUpdateFrameAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setForm(EMPTY_FORM);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card padding="md" className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Select
              label="상품 선택"
              value={selectedProductId ?? ''}
              onChange={(e) => onProductChange(e.target.value)}
              options={productOptions}
              placeholder={products.length === 0 ? '활성 상품이 없습니다' : '상품을 선택하세요'}
              disabled={products.length === 0}
            />
          </div>
          <Button
            variant="primary"
            onClick={openCreate}
            disabled={!selectedProductId}
            data-testid="frame-add-btn"
          >
            프레임 추가
          </Button>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b border-border">
              <tr>
                <th className="px-3 py-2">color_code</th>
                <th className="px-3 py-2">라벨</th>
                <th className="px-3 py-2">PNG</th>
                <th className="px-3 py-2">inner_rect</th>
                <th className="px-3 py-2">미리보기</th>
                <th className="px-3 py-2 text-right">동작</th>
              </tr>
            </thead>
            <tbody>
              {frames.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-fg">
                    {selectedProductId
                      ? '등록된 프레임 자산이 없습니다.'
                      : '상품을 선택하세요.'}
                  </td>
                </tr>
              ) : (
                frames.map((f) => (
                  <tr key={f.id as string} className="border-b border-border">
                    <td className="px-3 py-2 font-mono">{f.colorCode}</td>
                    <td className="px-3 py-2">{f.colorLabel}</td>
                    <td className="px-3 py-2 max-w-[180px] truncate">
                      <a
                        href={f.pngUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {f.pngUrl}
                      </a>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums">
                      {f.innerRect.x}, {f.innerRect.y}, {f.innerRect.w}, {f.innerRect.h}
                    </td>
                    <td className="px-3 py-2 max-w-[140px] truncate">
                      {f.previewUrl ? (
                        <a
                          href={f.previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          링크
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(f)}>
                        편집
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={form.id ? '프레임 수정' : '프레임 추가'}
        description="inner_rect 는 0~1 정규화된 좌표입니다."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              취소
            </Button>
            <Button
              type="submit"
              form="frame-form"
              loading={pending}
              disabled={pending}
            >
              저장
            </Button>
          </>
        }
      >
        <form id="frame-form" onSubmit={handleSubmit} className="space-y-3">
          <Input
            label="색상 코드 (color_code)"
            value={form.colorCode}
            onChange={(e) => setForm({ ...form, colorCode: e.target.value })}
            placeholder="black"
            required
            disabled={Boolean(form.id)}
            hint="소문자/숫자/_/- 만 허용. 저장 후 변경 불가."
          />
          <Input
            label="색상 라벨"
            value={form.colorLabel}
            onChange={(e) => setForm({ ...form, colorLabel: e.target.value })}
            placeholder="블랙"
            required
          />
          <Input
            label="PNG URL"
            type="url"
            value={form.pngUrl}
            onChange={(e) => setForm({ ...form, pngUrl: e.target.value })}
            placeholder="https://.../frame.png"
            required
            hint="https 만 허용 (ADR-016)."
          />
          <Input
            label="미리보기 URL (선택)"
            type="url"
            value={form.previewUrl}
            onChange={(e) => setForm({ ...form, previewUrl: e.target.value })}
            placeholder="https://.../preview.jpg"
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">inner_rect</legend>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="x"
                type="number"
                step="0.001"
                min={0}
                max={1}
                value={form.ix}
                onChange={(e) => setForm({ ...form, ix: e.target.value })}
                required
              />
              <Input
                label="y"
                type="number"
                step="0.001"
                min={0}
                max={1}
                value={form.iy}
                onChange={(e) => setForm({ ...form, iy: e.target.value })}
                required
              />
              <Input
                label="w"
                type="number"
                step="0.001"
                min={0.01}
                max={1}
                value={form.iw}
                onChange={(e) => setForm({ ...form, iw: e.target.value })}
                required
              />
              <Input
                label="h"
                type="number"
                step="0.001"
                min={0.01}
                max={1}
                value={form.ih}
                onChange={(e) => setForm({ ...form, ih: e.target.value })}
                required
              />
            </div>
          </fieldset>
          {error ? (
            <div
              role="alert"
              className="text-sm text-danger border border-danger px-3 py-2"
            >
              {error}
            </div>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}
