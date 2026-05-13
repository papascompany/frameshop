'use client';

/**
 * Client UI for /admin/curation:
 *  - 카드 리스트 (type/title/device/기간/활성)
 *  - 추가/수정 다이얼로그 with type-specific payload form
 *
 * payload UI:
 *  - banner: imageUrl + link + title + subtitle
 *  - collection: productIds (체크박스 다중 선택) + subtitle
 *  - feature: productId (단일 선택) + pitch
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type {
  BannerPayload,
  CollectionPayload,
  Curation,
  CurationDevice,
  CurationType,
  FeaturePayload,
} from '@/types/curation';
import type { Product } from '@/types/product';
import { upsertCurationAction, deleteCurationAction } from './actions';

type FormState = {
  id?: string;
  type: CurationType;
  title: string;
  device: CurationDevice;
  startAt: string;
  endAt: string;
  isActive: boolean;
  sortOrder: string;
  // payload-specific
  bannerImageUrl: string;
  bannerLink: string;
  bannerTitle: string;
  bannerSubtitle: string;
  collectionProductIds: string[];
  collectionSubtitle: string;
  featureProductId: string;
  featurePitch: string;
};

const EMPTY_FORM: FormState = {
  type: 'banner',
  title: '',
  device: 'all',
  startAt: '',
  endAt: '',
  isActive: true,
  sortOrder: '0',
  bannerImageUrl: '',
  bannerLink: '',
  bannerTitle: '',
  bannerSubtitle: '',
  collectionProductIds: [],
  collectionSubtitle: '',
  featureProductId: '',
  featurePitch: '',
};

// datetime-local input expects `YYYY-MM-DDTHH:mm` (no trailing Z).
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function curationToForm(c: Curation, products: Product[]): FormState {
  const base: FormState = {
    ...EMPTY_FORM,
    id: c.id as string,
    type: c.type,
    title: c.title ?? '',
    device: c.device,
    startAt: toLocalInput(c.startAt),
    endAt: toLocalInput(c.endAt),
    isActive: c.isActive,
    sortOrder: String(c.sortOrder),
  };
  const p = c.payload as Record<string, unknown> | null;
  if (!p) return base;

  if (c.type === 'banner') {
    return {
      ...base,
      bannerImageUrl: typeof p.imageUrl === 'string' ? p.imageUrl : '',
      bannerLink: typeof p.link === 'string' ? p.link : '',
      bannerTitle: typeof p.title === 'string' ? p.title : '',
      bannerSubtitle: typeof p.subtitle === 'string' ? p.subtitle : '',
    };
  }
  if (c.type === 'collection') {
    const ids = Array.isArray(p.productIds)
      ? (p.productIds as unknown[]).filter(
          (x): x is string =>
            typeof x === 'string' && products.some((pr) => pr.id === x),
        )
      : [];
    return {
      ...base,
      collectionProductIds: ids,
      collectionSubtitle: typeof p.subtitle === 'string' ? p.subtitle : '',
    };
  }
  // feature
  return {
    ...base,
    featureProductId: typeof p.productId === 'string' ? p.productId : '',
    featurePitch: typeof p.pitch === 'string' ? p.pitch : '',
  };
}

export function CurationClient({
  curations,
  products,
}: {
  curations: Curation[];
  products: Product[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id as string, p);
    return m;
  }, [products]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setOpen(true);
  }
  function openEdit(c: Curation) {
    setForm(curationToForm(c, products));
    setError(null);
    setOpen(true);
  }

  function buildPayload(): unknown {
    if (form.type === 'banner') {
      const payload: BannerPayload = {
        imageUrl: form.bannerImageUrl.trim(),
      };
      if (form.bannerLink.trim()) payload.link = form.bannerLink.trim();
      if (form.bannerTitle.trim()) payload.title = form.bannerTitle.trim();
      if (form.bannerSubtitle.trim()) payload.subtitle = form.bannerSubtitle.trim();
      return payload;
    }
    if (form.type === 'collection') {
      const payload: CollectionPayload = {
        productIds: form.collectionProductIds as CollectionPayload['productIds'],
      };
      if (form.collectionSubtitle.trim()) payload.subtitle = form.collectionSubtitle.trim();
      return payload;
    }
    const payload: FeaturePayload = {
      productId: form.featureProductId as FeaturePayload['productId'],
      pitch: form.featurePitch.trim(),
    };
    return payload;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sortOrder = Number(form.sortOrder);
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      setError('sort_order 는 0 이상의 정수입니다.');
      return;
    }
    const payload = buildPayload();

    startTransition(async () => {
      const result = await upsertCurationAction({
        ...(form.id ? { id: form.id } : {}),
        type: form.type,
        title: form.title.trim() ? form.title.trim() : null,
        payload,
        device: form.device,
        startAt: fromLocalInput(form.startAt),
        endAt: fromLocalInput(form.endAt),
        isActive: form.isActive,
        sortOrder,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setForm(EMPTY_FORM);
      router.refresh();
    });
  }

  function renderPayloadSummary(c: Curation) {
    const p = c.payload as Record<string, unknown> | null;
    if (!p) return '—';
    if (c.type === 'banner' && typeof p.imageUrl === 'string') {
      return p.imageUrl;
    }
    if (c.type === 'collection' && Array.isArray(p.productIds)) {
      return `${p.productIds.length}개 상품`;
    }
    if (c.type === 'feature' && typeof p.pitch === 'string') {
      return p.pitch;
    }
    return JSON.stringify(p).slice(0, 60);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={openCreate} data-testid="curation-add-btn">
          큐레이션 추가
        </Button>
      </div>

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        {curations.length === 0 ? (
          <Card padding="md" className="col-span-full">
            <p className="text-sm text-muted-fg text-center">
              등록된 큐레이션이 없습니다.
            </p>
          </Card>
        ) : (
          curations.map((c) => (
            <Card key={c.id as string} padding="md" className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={c.isActive ? 'success' : 'default'}>
                      {c.isActive ? '활성' : '비활성'}
                    </Badge>
                    <Badge variant="default">{c.type}</Badge>
                    <Badge variant="default">{c.device}</Badge>
                  </div>
                  <h3 className="text-base font-semibold truncate">
                    {c.title ?? '(제목 없음)'}
                  </h3>
                  <p className="text-xs text-muted-fg truncate">
                    {renderPayloadSummary(c)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                    편집
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (!confirm(`"${c.title ?? '(제목 없음)'}" 큐레이션을 삭제하시겠습니까?`)) return;
                      startTransition(async () => {
                        const result = await deleteCurationAction(c.id as string);
                        if (!result.ok) {
                          alert(`삭제 실패: ${result.error}`);
                          return;
                        }
                        router.refresh();
                      });
                    }}
                  >
                    삭제
                  </Button>
                </div>
              </div>
              <dl className="text-xs text-muted-fg grid grid-cols-2 gap-x-3">
                <div>
                  <dt className="inline">시작:</dt>{' '}
                  <dd className="inline tabular-nums">
                    {c.startAt ? new Date(c.startAt).toLocaleString('ko-KR') : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="inline">종료:</dt>{' '}
                  <dd className="inline tabular-nums">
                    {c.endAt ? new Date(c.endAt).toLocaleString('ko-KR') : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="inline">정렬:</dt>{' '}
                  <dd className="inline tabular-nums">{c.sortOrder}</dd>
                </div>
              </dl>
            </Card>
          ))
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={form.id ? '큐레이션 수정' : '큐레이션 추가'}
        description="payload 필드는 type 에 따라 달라집니다."
        maxWidth="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              취소
            </Button>
            <Button
              type="submit"
              form="curation-form"
              loading={pending}
              disabled={pending}
            >
              저장
            </Button>
          </>
        }
      >
        <form id="curation-form" onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="type"
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as CurationType })
              }
              options={[
                { value: 'banner', label: 'banner (배너)' },
                { value: 'collection', label: 'collection (컬렉션)' },
                { value: 'feature', label: 'feature (피처)' },
              ]}
              disabled={Boolean(form.id)}
            />
            <Select
              label="device"
              value={form.device}
              onChange={(e) =>
                setForm({ ...form, device: e.target.value as CurationDevice })
              }
              options={[
                { value: 'all', label: 'all (전체)' },
                { value: 'pc', label: 'pc' },
                { value: 'mobile', label: 'mobile' },
              ]}
            />
          </div>
          <Input
            label="제목 (선택)"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="신상품 모음"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="시작 일시"
              type="datetime-local"
              value={form.startAt}
              onChange={(e) => setForm({ ...form, startAt: e.target.value })}
            />
            <Input
              label="종료 일시"
              type="datetime-local"
              value={form.endAt}
              onChange={(e) => setForm({ ...form, endAt: e.target.value })}
            />
          </div>

          <fieldset className="space-y-3 border-t border-border pt-3">
            <legend className="text-sm font-medium">payload</legend>

            {form.type === 'banner' ? (
              <>
                <Input
                  label="image URL"
                  type="url"
                  value={form.bannerImageUrl}
                  onChange={(e) => setForm({ ...form, bannerImageUrl: e.target.value })}
                  placeholder="https://.../banner.jpg"
                  required
                  hint="https 만 허용 (ADR-016)."
                />
                <Input
                  label="링크 URL (선택)"
                  type="url"
                  value={form.bannerLink}
                  onChange={(e) => setForm({ ...form, bannerLink: e.target.value })}
                  placeholder="https://..."
                />
                <Input
                  label="배너 타이틀 (선택)"
                  value={form.bannerTitle}
                  onChange={(e) => setForm({ ...form, bannerTitle: e.target.value })}
                />
                <Input
                  label="배너 서브타이틀 (선택)"
                  value={form.bannerSubtitle}
                  onChange={(e) => setForm({ ...form, bannerSubtitle: e.target.value })}
                />
              </>
            ) : null}

            {form.type === 'collection' ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">상품 선택 (1~20개)</span>
                  <div
                    className="max-h-48 overflow-y-auto border border-border rounded-input p-2 space-y-1"
                    role="group"
                    aria-label="상품 선택"
                  >
                    {products.length === 0 ? (
                      <p className="text-xs text-muted-fg">활성 상품이 없습니다.</p>
                    ) : (
                      products.map((p) => {
                        const checked = form.collectionProductIds.includes(p.id as string);
                        return (
                          <label
                            key={p.id as string}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const id = p.id as string;
                                setForm((prev) => ({
                                  ...prev,
                                  collectionProductIds: e.target.checked
                                    ? [...prev.collectionProductIds, id]
                                    : prev.collectionProductIds.filter((x) => x !== id),
                                }));
                              }}
                              className="h-4 w-4"
                            />
                            <span className="truncate">{p.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <p className="text-xs text-muted-fg">
                    선택됨: {form.collectionProductIds.length}개
                  </p>
                </div>
                <Input
                  label="서브타이틀 (선택)"
                  value={form.collectionSubtitle}
                  onChange={(e) =>
                    setForm({ ...form, collectionSubtitle: e.target.value })
                  }
                />
              </>
            ) : null}

            {form.type === 'feature' ? (
              <>
                <Select
                  label="대표 상품"
                  value={form.featureProductId}
                  onChange={(e) =>
                    setForm({ ...form, featureProductId: e.target.value })
                  }
                  options={products.map((p) => ({
                    value: p.id as string,
                    label: p.name,
                  }))}
                  placeholder="상품을 선택하세요"
                  required
                />
                <Input
                  label="피치 (1~160자)"
                  value={form.featurePitch}
                  onChange={(e) => setForm({ ...form, featurePitch: e.target.value })}
                  maxLength={160}
                  required
                />
                {form.featureProductId && productById.has(form.featureProductId) ? (
                  <p className="text-xs text-muted-fg">
                    선택된 상품: {productById.get(form.featureProductId)?.name}
                  </p>
                ) : null}
              </>
            ) : null}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="sort_order"
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              required
            />
            <label className="flex items-end gap-2 text-sm pb-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4"
              />
              <span>활성 (is_active)</span>
            </label>
          </div>

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
