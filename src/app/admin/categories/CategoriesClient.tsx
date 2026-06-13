'use client';

/**
 * 상품 라인(카테고리) 관리 — 생성/수정/정렬/활성토글/삭제.
 *
 * 카테고리는 /catalog/<slug> 경로로 노출되며, 상품 등록 시 이 카테고리에
 * 배정합니다. 저장 시 catalog/landing 캐시(tag 'categories')를 무효화합니다.
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { Category } from '@/types/product';
import {
  upsertCategoryAction,
  toggleCategoryActiveAction,
  deleteCategoryAction,
} from './actions';

type FormState = {
  id?: string;
  name: string;
  slug: string;
  parentId: string;
  sortOrder: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  slug: '',
  parentId: '',
  sortOrder: '0',
  isActive: true,
};

function categoryToForm(c: Category): FormState {
  return {
    id: c.id as string,
    name: c.name,
    slug: c.slug,
    parentId: (c.parentId as string | null) ?? '',
    sortOrder: String(c.sortOrder),
    isActive: c.isActive,
  };
}

export function CategoriesClient({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id as string, c.name);
    return m;
  }, [categories]);

  // 상위 후보: 편집 중인 자기 자신은 제외 (순환 방지).
  const parentOptions = useMemo(
    () =>
      categories
        .filter((c) => (c.id as string) !== form.id)
        .map((c) => ({ value: c.id as string, label: c.name })),
    [categories, form.id],
  );

  function openCreate() {
    setForm({ ...EMPTY_FORM, sortOrder: String(categories.length) });
    setError(null);
    setOpen(true);
  }
  function openEdit(c: Category) {
    setForm(categoryToForm(c));
    setError(null);
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const sortOrder = Number(form.sortOrder);
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      setError('정렬 순서는 0 이상의 숫자여야 합니다.');
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      if (form.id) fd.append('id', form.id);
      fd.append('name', form.name.trim());
      fd.append('slug', form.slug.trim());
      fd.append('parentId', form.parentId);
      fd.append('sortOrder', String(sortOrder));
      fd.append('isActive', String(form.isActive));

      const result = await upsertCategoryAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setForm(EMPTY_FORM);
      router.refresh();
    });
  }

  async function handleToggle(c: Category) {
    setBusyId(c.id as string);
    const result = await toggleCategoryActiveAction(c.id as string, !c.isActive);
    setBusyId(null);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete(c: Category) {
    if (!window.confirm(`'${c.name}' 카테고리를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBusyId(c.id as string);
    const result = await deleteCategoryAction(c.id as string);
    setBusyId(null);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    router.refresh();
  }

  // 이름 입력 시 슬러그가 비어 있고 ASCII면 자동 제안.
  function onNameChange(name: string) {
    setForm((f) => {
      const next = { ...f, name };
      if (!f.id && (f.slug === '' || f.slug === slugify(f.name))) {
        next.slug = slugify(name);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Card padding="md" className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-fg">
          카테고리는 <span className="font-mono">/catalog/&lt;슬러그&gt;</span> 로 노출되고, 상품 등록 시 배정합니다.
        </p>
        <Button variant="primary" onClick={openCreate} data-testid="category-add-btn">
          카테고리 추가
        </Button>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b border-border">
              <tr>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">슬러그</th>
                <th className="px-3 py-2">상위</th>
                <th className="px-3 py-2 text-center">정렬</th>
                <th className="px-3 py-2 text-center">상태</th>
                <th className="px-3 py-2 text-right">동작</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-fg">
                    카테고리가 없습니다. <span className="underline cursor-pointer" onClick={openCreate}>추가</span>해 보세요.
                  </td>
                </tr>
              ) : (
                categories.map((c) => {
                  const id = c.id as string;
                  const busy = busyId === id;
                  return (
                    <tr key={id} className="border-b border-border">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <a
                          href={`/catalog/${c.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          {c.slug}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-muted-fg">
                        {c.parentId ? nameById.get(c.parentId as string) ?? '—' : '최상위'}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">{c.sortOrder}</td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                            c.isActive ? 'bg-success/10 text-success' : 'bg-soft-cloud text-mute'
                          }`}
                        >
                          {c.isActive ? '활성' : '비활성'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(c)} disabled={busy}>
                            편집
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void handleToggle(c)} disabled={busy}>
                            {c.isActive ? '비활성화' : '활성화'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void handleDelete(c)} disabled={busy}>
                            삭제
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={form.id ? '카테고리 수정' : '카테고리 추가'}
        description="이름과 슬러그(URL)는 필수입니다."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              취소
            </Button>
            <Button type="submit" form="category-form" loading={pending} disabled={pending}>
              저장
            </Button>
          </>
        }
      >
        <form id="category-form" onSubmit={handleSubmit} className="space-y-3">
          <Input
            label="이름"
            value={form.name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="프리미엄 액자"
            required
          />
          <Input
            label="슬러그 (URL)"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder="premium-frame"
            required
            hint="/catalog/슬러그 로 노출. 소문자/숫자/하이픈만. 변경 시 기존 링크가 깨질 수 있어요."
          />
          <Select
            label="상위 카테고리 (선택)"
            value={form.parentId}
            onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            options={parentOptions}
            placeholder="최상위 (없음)"
          />
          <Input
            label="정렬 순서"
            type="number"
            min={0}
            step={1}
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            hint="낮을수록 앞에 표시됩니다."
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            활성 (고객에게 노출)
          </label>
          {error ? (
            <div role="alert" className="text-sm text-danger border border-danger px-3 py-2 rounded">
              {error}
            </div>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}

/** ASCII 이름 → 슬러그 제안 (한글 등은 빈 문자열 → 관리자가 직접 입력). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
