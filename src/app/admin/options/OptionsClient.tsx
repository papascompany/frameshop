'use client';

/**
 * Client UI for /admin/options:
 *  - 상품 선택 dropdown
 *  - CSV import 텍스트 영역 + 결과 리포트
 *  - 변형 표 (가로 스크롤) + 행 클릭 시 인라인 편집 모달
 *  - 신규 변형 추가 모달
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type {
  MatteCode,
  PaperCode,
  Product,
  ProductVariant,
} from '@/types/product';
import type { ImportReport } from '@/types/admin';
import {
  importVariantsAction,
  upsertSingleVariantAction,
} from './actions';

const SAMPLE_CSV = `size_code,size_label,width_mm,height_mm,color_code,matte_code,paper_code,price,stock,is_active
4x6,4x6,102,152,black,none,glossy,12000,100,true
4x6,4x6,102,152,black,with,glossy,14000,100,true`;

type VariantForm = {
  id?: string;
  sizeCode: string;
  sizeLabel: string;
  widthMm: string;
  heightMm: string;
  colorCode: string;
  matteCode: MatteCode;
  paperCode: PaperCode;
  price: string;
  stock: string;
  isActive: boolean;
};

const EMPTY_FORM: VariantForm = {
  sizeCode: '',
  sizeLabel: '',
  widthMm: '',
  heightMm: '',
  colorCode: '',
  matteCode: 'none',
  paperCode: 'glossy',
  price: '',
  stock: '0',
  isActive: true,
};

function variantToForm(v: ProductVariant): VariantForm {
  return {
    id: v.id as string,
    sizeCode: v.sizeCode,
    sizeLabel: v.sizeLabel,
    widthMm: String(v.widthMm),
    heightMm: String(v.heightMm),
    colorCode: v.colorCode,
    matteCode: v.matteCode,
    paperCode: v.paperCode,
    price: String(v.price),
    stock: String(v.stock),
    isActive: v.isActive,
  };
}

export function OptionsClient({
  products,
  selectedProductId,
  variants,
  embedded = false,
}: {
  products: Product[];
  selectedProductId: string | null;
  variants: ProductVariant[];
  /**
   * FS-X-03: /admin/products/[id] 워크스페이스 임베드 모드 — 상품 dropdown 을
   * 숨기고 selectedProductId 를 고정한다(router.push 이동 없음). 단독 페이지
   * (/admin/options) 동작은 기본값 false 로 문자 그대로 유지된다.
   */
  embedded?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [csvText, setCsvText] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, startImport] = useTransition();

  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<VariantForm>(EMPTY_FORM);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [savingVariant, startSavingVariant] = useTransition();

  const productOptions = products.map((p) => ({ value: p.id as string, label: p.name }));

  function onProductChange(productId: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('product', productId);
    router.push(`/admin/options?${params.toString()}`);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditorError(null);
    setEditorOpen(true);
  }

  function openEdit(v: ProductVariant) {
    setForm(variantToForm(v));
    setEditorError(null);
    setEditorOpen(true);
  }

  function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setImportError(null);
    setReport(null);
    if (!selectedProductId) {
      setImportError('상품을 먼저 선택해 주세요.');
      return;
    }
    if (csvText.trim().length === 0) {
      setImportError('CSV/TSV 내용을 입력해 주세요.');
      return;
    }
    startImport(async () => {
      const result = await importVariantsAction(selectedProductId, csvText);
      if (!result.ok) {
        setImportError(result.error);
        return;
      }
      setReport(result.report);
      router.refresh();
    });
  }

  function handleVariantSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEditorError(null);
    if (!selectedProductId) return;

    const widthMm = Number(form.widthMm);
    const heightMm = Number(form.heightMm);
    const price = Number(form.price);
    const stock = Number(form.stock);
    if ([widthMm, heightMm, price, stock].some((n) => !Number.isFinite(n))) {
      setEditorError('숫자 필드를 확인해 주세요.');
      return;
    }
    if (widthMm <= 0 || heightMm <= 0) {
      setEditorError('width/height 는 양수여야 합니다.');
      return;
    }
    if (price < 0 || stock < 0) {
      setEditorError('price/stock 은 0 이상이어야 합니다.');
      return;
    }

    startSavingVariant(async () => {
      const result = await upsertSingleVariantAction(selectedProductId, {
        sizeCode: form.sizeCode.trim(),
        sizeLabel: form.sizeLabel.trim(),
        widthMm,
        heightMm,
        colorCode: form.colorCode.trim(),
        matteCode: form.matteCode,
        paperCode: form.paperCode,
        price,
        stock,
        isActive: form.isActive,
      });
      if (!result.ok) {
        setEditorError(result.error);
        return;
      }
      if (result.report.errors.length > 0) {
        setEditorError(result.report.errors[0]?.message ?? '저장 실패');
        return;
      }
      setEditorOpen(false);
      setForm(EMPTY_FORM);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card padding="md" className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          {embedded ? null : (
            <div className="flex-1">
              <Select
                label="상품 선택"
                value={selectedProductId ?? ''}
                onChange={(e) => onProductChange(e.target.value)}
                options={productOptions}
                placeholder={products.length === 0 ? '상품이 없습니다' : '상품을 선택하세요'}
                disabled={products.length === 0}
              />
            </div>
          )}
          <Button
            variant="primary"
            onClick={openCreate}
            disabled={!selectedProductId}
            data-testid="variant-add-btn"
          >
            새 변형 추가
          </Button>
        </div>
      </Card>

      <Card padding="md" className="space-y-3">
        <form onSubmit={handleImport} className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="csv-input"
              className="text-sm font-medium text-foreground"
            >
              CSV / TSV 일괄 등록
            </label>
            <p className="text-xs text-muted-fg">
              헤더(필수):{' '}
              <code className="font-mono">
                size_code,size_label,width_mm,height_mm,color_code,matte_code,paper_code,price,stock
              </code>{' '}
              + 선택 <code className="font-mono">is_active</code>. TSV(탭 구분)도 자동
              인식. UTF-8 BOM 허용.
            </p>
            <textarea
              id="csv-input"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={6}
              placeholder={SAMPLE_CSV}
              className="w-full font-mono text-xs bg-surface border border-border rounded-input p-2 focus:outline-none focus:border-foreground"
              data-testid="variant-csv-input"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              loading={importing}
              disabled={importing || !selectedProductId}
            >
              CSV 가져오기
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCsvText(SAMPLE_CSV)}
              disabled={importing}
            >
              샘플 채우기
            </Button>
          </div>
          {importError ? (
            <div
              role="alert"
              className="text-sm text-danger border border-danger px-3 py-2"
            >
              {importError}
            </div>
          ) : null}
          {report ? (
            <div
              role="status"
              className="text-sm border border-border bg-surface-muted px-3 py-2 space-y-1"
            >
              <p>
                성공:{' '}
                <strong className="tabular-nums">
                  {report.inserted + report.updated}
                </strong>{' '}
                · 실패:{' '}
                <strong className="tabular-nums">{report.skipped + report.errors.length}</strong>
              </p>
              {report.errors.length > 0 ? (
                <ul className="text-xs text-muted-fg list-disc pl-5">
                  {report.errors.slice(0, 10).map((er, i) => (
                    <li key={`${er.row}-${i}`}>
                      행 {er.row} · {er.field}: {er.message}
                    </li>
                  ))}
                  {report.errors.length > 10 ? (
                    <li>외 {report.errors.length - 10}건…</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
        </form>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b border-border whitespace-nowrap">
              <tr>
                <th className="px-3 py-2">사이즈</th>
                <th className="px-3 py-2">컬러</th>
                <th className="px-3 py-2">매트</th>
                <th className="px-3 py-2">인화지</th>
                <th className="px-3 py-2 text-right">가격</th>
                <th className="px-3 py-2 text-right">재고</th>
                <th className="px-3 py-2">활성</th>
                <th className="px-3 py-2 text-right">동작</th>
              </tr>
            </thead>
            <tbody>
              {variants.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-muted-fg"
                  >
                    {selectedProductId
                      ? '등록된 변형이 없습니다.'
                      : '상품을 선택하세요.'}
                  </td>
                </tr>
              ) : (
                variants.map((v) => (
                  <tr
                    key={v.id as string}
                    className="border-b border-border whitespace-nowrap"
                  >
                    <td className="px-3 py-2 font-mono">
                      {v.sizeCode}
                      <span className="text-muted-fg"> · {v.sizeLabel}</span>
                    </td>
                    <td className="px-3 py-2 font-mono">{v.colorCode}</td>
                    <td className="px-3 py-2 font-mono">{v.matteCode}</td>
                    <td className="px-3 py-2 font-mono">{v.paperCode}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {v.price.toLocaleString('ko-KR')}원
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {v.stock.toLocaleString('ko-KR')}
                    </td>
                    <td className="px-3 py-2">{v.isActive ? '✓' : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(v)}
                      >
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
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={form.id ? '변형 수정' : '새 변형'}
        description="동일 (size,color,matte,paper) 조합은 upsert 됩니다."
        maxWidth="max-w-lg"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setEditorOpen(false)}
              disabled={savingVariant}
            >
              취소
            </Button>
            <Button
              type="submit"
              form="variant-form"
              loading={savingVariant}
              disabled={savingVariant}
            >
              저장
            </Button>
          </>
        }
      >
        <form
          id="variant-form"
          onSubmit={handleVariantSubmit}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="size_code"
              value={form.sizeCode}
              onChange={(e) => setForm({ ...form, sizeCode: e.target.value })}
              required
              disabled={Boolean(form.id)}
            />
            <Input
              label="size_label"
              value={form.sizeLabel}
              onChange={(e) => setForm({ ...form, sizeLabel: e.target.value })}
              required
            />
            <Input
              label="width_mm"
              type="number"
              min={1}
              value={form.widthMm}
              onChange={(e) => setForm({ ...form, widthMm: e.target.value })}
              required
            />
            <Input
              label="height_mm"
              type="number"
              min={1}
              value={form.heightMm}
              onChange={(e) => setForm({ ...form, heightMm: e.target.value })}
              required
            />
            <Input
              label="color_code"
              value={form.colorCode}
              onChange={(e) => setForm({ ...form, colorCode: e.target.value })}
              required
              disabled={Boolean(form.id)}
            />
            <Select
              label="matte_code"
              value={form.matteCode}
              onChange={(e) =>
                setForm({ ...form, matteCode: e.target.value as MatteCode })
              }
              options={[
                { value: 'none', label: 'none (없음)' },
                { value: 'with', label: 'with (있음)' },
              ]}
              disabled={Boolean(form.id)}
            />
            <Select
              label="paper_code"
              value={form.paperCode}
              onChange={(e) =>
                setForm({ ...form, paperCode: e.target.value as PaperCode })
              }
              options={[
                { value: 'glossy', label: 'glossy (유광)' },
                { value: 'matte', label: 'matte (무광)' },
                { value: 'fineart', label: 'fineart (파인아트)' },
              ]}
              disabled={Boolean(form.id)}
            />
            <Input
              label="price (원)"
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
            <Input
              label="stock"
              type="number"
              min={0}
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4"
            />
            <span>활성 (is_active)</span>
          </label>
          {editorError ? (
            <div
              role="alert"
              className="text-sm text-danger border border-danger px-3 py-2"
            >
              {editorError}
            </div>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}
