'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { Product } from '@/types/product';
import type { CategoryTreeNode } from '@/types/product';
import {
  upsertProductAction,
  toggleProductActiveAction,
  deleteProductAction,
} from './actions';

type ProductWithThumbnail = Product & { thumbnail: string | null };
type FlatCategory = { value: string; label: string };

function flattenCategories(nodes: CategoryTreeNode[], depth = 0): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const node of nodes) {
    const prefix = depth > 0 ? '  '.repeat(depth) + '└ ' : '';
    result.push({ value: node.id as string, label: prefix + node.name });
    if (node.children.length > 0) {
      result.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return result;
}

type FormState = {
  id?: string;
  name: string;
  categoryId: string;
  tagline: string;
  description: string;
  basePrice: string;
  hasFrame: boolean;
  isActive: boolean;
  sortOrder: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  categoryId: '',
  tagline: '',
  description: '',
  basePrice: '0',
  hasFrame: false,
  isActive: true,
  sortOrder: '0',
};

function productToForm(p: ProductWithThumbnail): FormState {
  return {
    id: p.id as string,
    name: p.name,
    categoryId: p.categoryId as string,
    tagline: p.tagline,
    description: p.description,
    basePrice: String(p.basePrice),
    hasFrame: p.hasFrame,
    isActive: p.isActive,
    sortOrder: String(p.sortOrder),
  };
}

const IconPlus = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden>
    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
  </svg>
);

const IconPhoto = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden>
    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm2.25-.75a.75.75 0 0 0-.75.75v6.27l3.693-3.03a.75.75 0 0 1 .964.026l4.004 3.754 1.242-.836a.75.75 0 0 1 .894.062l2.953 2.637V5.25a.75.75 0 0 0-.75-.75H3.25Zm13.5 10.5a.75.75 0 0 0 .75-.75v-.358l-3.165-2.824-1.259.847a.75.75 0 0 1-.916-.062l-3.985-3.73-3.675 3.016V14.75a.75.75 0 0 0 .75.75h11.5Z" clipRule="evenodd" />
  </svg>
);

export function ProductsClient({
  products,
  categories,
}: {
  products: ProductWithThumbnail[];
  categories: CategoryTreeNode[];
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const categoryOptions = flattenCategories(categories);

  const categoryMap = new Map<string, string>();
  function buildCategoryMap(nodes: CategoryTreeNode[]) {
    for (const node of nodes) {
      categoryMap.set(node.id as string, node.name);
      buildCategoryMap(node.children);
    }
  }
  buildCategoryMap(categories);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setOpen(true);
  }

  function openEdit(p: ProductWithThumbnail) {
    setForm(productToForm(p));
    setError(null);
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const fd = new FormData();
      if (form.id) fd.append('id', form.id);
      fd.append('name', form.name);
      fd.append('categoryId', form.categoryId);
      fd.append('tagline', form.tagline);
      fd.append('description', form.description);
      fd.append('basePrice', form.basePrice);
      fd.append('hasFrame', String(form.hasFrame));
      fd.append('isActive', String(form.isActive));
      fd.append('sortOrder', form.sortOrder);

      const result = await upsertProductAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setForm(EMPTY_FORM);
    });
  }

  function handleToggleActive(p: ProductWithThumbnail) {
    startTransition(async () => {
      await toggleProductActiveAction(p.id as string, !p.isActive);
    });
  }

  function handleDelete(p: ProductWithThumbnail) {
    if (!confirm(`"${p.name}" 상품을 삭제하시겠습니까? 연결된 이미지도 함께 삭제됩니다.`)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteProductAction(p.id as string);
      if (!result.ok) {
        alert(`삭제 실패: ${result.error}`);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">상품 목록</h2>
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold bg-soft-cloud text-mute rounded-full">
            {products.length}
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={openCreate}
          disabled={pending}
          startIcon={<IconPlus />}
        >
          상품 등록
        </Button>
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block bg-canvas border border-hairline overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-soft-cloud border-b border-hairline">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute w-12">
                  썸네일
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">
                  상품명
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-mute">
                  카테고리
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-mute">
                  기본가격
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-mute">
                  프레임
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-mute">
                  상태
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-mute">
                  동작
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-mute text-sm">
                    등록된 상품이 없습니다.
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr
                    key={p.id as string}
                    className="hover:bg-soft-cloud/60 transition-colors"
                  >
                    <td className="px-4 py-3">
                      {p.thumbnail ? (
                        <Image
                          src={p.thumbnail}
                          alt={p.name}
                          width={36}
                          height={36}
                          className="object-cover rounded"
                        />
                      ) : (
                        <div className="w-9 h-9 bg-soft-cloud rounded flex items-center justify-center text-stone">
                          <IconPhoto />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {p.name}
                    </td>
                    <td className="px-4 py-3 text-mute text-sm">
                      {categoryMap.get(p.categoryId as string) ?? p.categoryId}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right font-medium text-ink">
                      {p.basePrice.toLocaleString('ko-KR')}원
                    </td>
                    <td className="px-4 py-3 text-center text-mute">
                      {p.hasFrame ? (
                        <span className="text-success font-semibold">O</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(p)}
                        disabled={pending}
                        className={cn(
                          'text-xs px-2.5 py-1 rounded-full font-semibold transition-colors',
                          p.isActive
                            ? 'bg-success/10 text-success hover:bg-success/20'
                            : 'bg-soft-cloud text-mute hover:bg-hairline',
                        )}
                      >
                        {p.isActive ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(p)}
                        disabled={pending}
                      >
                        수정
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(p)}
                        disabled={pending}
                        className="text-sale hover:text-sale"
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
      </div>

      {/* Mobile: card list */}
      <div className="md:hidden space-y-2">
        {products.length === 0 ? (
          <div className="bg-canvas border border-hairline p-8 text-center text-mute text-sm">
            등록된 상품이 없습니다.
          </div>
        ) : (
          products.map((p) => (
            <div
              key={p.id as string}
              className="bg-canvas border border-hairline p-4 flex items-center gap-3"
            >
              {/* Thumbnail */}
              <div className="shrink-0">
                {p.thumbnail ? (
                  <Image
                    src={p.thumbnail}
                    alt={p.name}
                    width={48}
                    height={48}
                    className="object-cover rounded"
                  />
                ) : (
                  <div className="w-12 h-12 bg-soft-cloud rounded flex items-center justify-center text-stone">
                    <IconPhoto />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink text-sm truncate">{p.name}</p>
                <p className="text-xs text-mute truncate">
                  {categoryMap.get(p.categoryId as string) ?? p.categoryId}
                </p>
                <p className="text-xs font-medium text-ink mt-0.5 tabular-nums">
                  {p.basePrice.toLocaleString('ko-KR')}원
                </p>
              </div>

              {/* Actions */}
              <div className="shrink-0 flex flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleActive(p)}
                  disabled={pending}
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-semibold transition-colors',
                    p.isActive
                      ? 'bg-success/10 text-success'
                      : 'bg-soft-cloud text-mute',
                  )}
                >
                  {p.isActive ? '활성' : '비활성'}
                </button>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(p)}
                    disabled={pending}
                  >
                    수정
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Dialog */}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={form.id ? '상품 수정' : '상품 등록'}
        description="기본 정보를 입력하세요. 이미지 업로드는 별도 탭에서 진행합니다."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              취소
            </Button>
            <Button
              type="submit"
              form="product-form"
              loading={pending}
              disabled={pending}
            >
              저장
            </Button>
          </>
        }
      >
        <form id="product-form" onSubmit={handleSubmit} className="space-y-3">
          <Input
            label="상품명"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="예: 클래식 우드 프레임"
            required
          />

          <Select
            label="카테고리"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            options={categoryOptions}
            placeholder="카테고리를 선택하세요"
            required
          />

          <Input
            label="태그라인"
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            placeholder="짧은 한 줄 소개 (최대 120자)"
            maxLength={120}
          />

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              설명
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="상품 상세 설명 (마크다운 지원 예정)"
              rows={4}
              maxLength={50000}
              className="w-full border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-ink/20 resize-y"
            />
          </div>

          <Input
            label="기본 가격 (원)"
            type="number"
            min={0}
            step={100}
            value={form.basePrice}
            onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
            required
          />

          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.hasFrame}
                onChange={(e) => setForm({ ...form, hasFrame: e.target.checked })}
                className="w-4 h-4 rounded border-hairline"
              />
              <span>프레임 유무</span>
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-hairline"
              />
              <span>활성</span>
            </label>
          </div>

          <Input
            label="정렬 순서"
            type="number"
            min={0}
            step={1}
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            hint="낮을수록 앞에 표시됩니다."
          />

          {error ? (
            <div
              role="alert"
              className="text-sm text-sale border border-sale px-3 py-2 rounded"
            >
              {error}
            </div>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}
