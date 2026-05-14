'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
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
      <div className="flex justify-end">
        <Button variant="primary" onClick={openCreate} disabled={pending}>
          상품 등록
        </Button>
      </div>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b border-border bg-muted/40">
              <tr>
                <th className="px-3 py-2 w-10">썸네일</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2">카테고리</th>
                <th className="px-3 py-2 tabular-nums text-right">기본가격</th>
                <th className="px-3 py-2 text-center">프레임</th>
                <th className="px-3 py-2 text-center">활성</th>
                <th className="px-3 py-2 text-right">동작</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-fg">
                    등록된 상품이 없습니다.
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id as string} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-2">
                      {p.thumbnail ? (
                        <Image
                          src={p.thumbnail}
                          alt={p.name}
                          width={32}
                          height={32}
                          className="object-cover rounded"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-muted rounded flex items-center justify-center text-muted-fg text-xs">
                          —
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-muted-fg">
                      {categoryMap.get(p.categoryId as string) ?? p.categoryId}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-right">
                      {p.basePrice.toLocaleString('ko-KR')}원
                    </td>
                    <td className="px-3 py-2 text-center">
                      {p.hasFrame ? 'O' : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(p)}
                        disabled={pending}
                        className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                          p.isActive
                            ? 'bg-success/10 text-success hover:bg-success/20'
                            : 'bg-muted text-muted-fg hover:bg-muted/70'
                        }`}
                      >
                        {p.isActive ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right space-x-1 whitespace-nowrap">
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
            <label className="block text-sm font-medium text-foreground mb-1">
              설명
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="상품 상세 설명 (마크다운 지원 예정)"
              rows={4}
              maxLength={50000}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-fg focus:outline-none focus:ring-2 focus:ring-ring resize-y"
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
                className="w-4 h-4 rounded border-border"
              />
              <span>프레임 유무</span>
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-border"
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
              className="text-sm text-danger border border-danger px-3 py-2 rounded"
            >
              {error}
            </div>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}
