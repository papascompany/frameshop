'use client';

/**
 * 상품 워크스페이스 탭 UI (FS-X-03).
 *
 * 탭0 유형: product_type 표시 + single→extended 승격(비파괴 update).
 *          extended→single 다운은 세트/규칙 존재 시 차단 안내.
 * 탭1 속성: 기존 ProductsClient Dialog 폼을 인라인 재구성(upsertProductAction 재사용).
 * 탭2 프레임 / 탭3 옵션: FramesClient/OptionsClient 임베드(embedded prop —
 *          상품 dropdown 숨김, selectedProductId 고정).
 * 탭4 구성규칙 / 탭5 세트템플릿: 확장형 전용(BundleRuleForm/SetTemplatesPanel).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import type {
  CategoryTreeNode,
  FrameAsset,
  Product,
  ProductVariant,
} from '@/types/product';
import type { BundleRule, SetTemplate } from '@/types/set';
import { FramesClient } from '../../frames/FramesClient';
import { OptionsClient } from '../../options/OptionsClient';
import { upsertProductAction } from '../actions';
import { promoteProductTypeAction } from './actions';
import { visibleWorkspaceTabs, type WorkspaceTabId } from './workspace-tabs';
import { BundleRuleForm } from './BundleRuleForm';
import { SetTemplatesPanel } from './SetTemplatesPanel';

type Props = {
  product: Product;
  categories: CategoryTreeNode[];
  frames: FrameAsset[];
  variants: ProductVariant[];
  setTemplates: SetTemplate[];
  bundleRule: BundleRule | null;
  setTemplatesAvailable: boolean;
  bundleRulesAvailable: boolean;
};

type FlatCategory = { value: string; label: string };

function flattenCategories(nodes: CategoryTreeNode[], depth = 0): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const node of nodes) {
    const prefix = depth > 0 ? '  '.repeat(depth) + '└ ' : '';
    result.push({ value: node.id as string, label: prefix + node.name });
    if (node.children.length > 0) {
      result.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return result;
}

// ---------- 탭0: 유형 ----------

function TypePanel({
  product,
  hasExtendedAssets,
}: {
  product: Product;
  hasExtendedAssets: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const productType = product.productType ?? 'single';

  function submitType(target: 'single' | 'extended') {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append('productId', product.id as string);
      fd.append('productType', target);
      const result = await promoteProductTypeAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card padding="md" className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">상품 유형</h2>
        <span
          className={cn(
            'inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full',
            productType === 'extended'
              ? 'bg-success/10 text-success'
              : 'bg-surface-muted text-muted-fg',
          )}
          data-testid="product-type-badge"
        >
          {productType === 'extended' ? '확장형 (extended)' : '베이직 (single)'}
        </span>
      </div>

      <p className="text-sm text-muted-fg">
        베이직 = 사진 1장 · 단일 사이즈. 확장형 = 멀티포토 · 혼합 사이즈/방향 ·
        세트 구성(구성규칙/세트템플릿 탭 활성화).
      </p>

      {productType === 'single' ? (
        <Button
          variant="primary"
          onClick={() => submitType('extended')}
          loading={pending}
          disabled={pending}
          data-testid="promote-extended-btn"
        >
          확장형으로 승격
        </Button>
      ) : (
        <div className="space-y-2">
          <Button
            variant="ghost"
            onClick={() => submitType('single')}
            loading={pending}
            disabled={pending || hasExtendedAssets}
            data-testid="demote-single-btn"
          >
            베이직으로 전환
          </Button>
          {hasExtendedAssets ? (
            <p className="text-xs text-muted-fg">
              세트 템플릿 또는 구성 규칙이 등록되어 있어 전환할 수 없습니다. 먼저
              세트/규칙을 삭제하세요.
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <div role="alert" className="text-sm text-danger border border-danger px-3 py-2">
          {error}
        </div>
      ) : null}
    </Card>
  );
}

// ---------- 탭1: 속성 (ProductsClient Dialog 폼 인라인 재구성) ----------

type AttrsForm = {
  name: string;
  categoryId: string;
  tagline: string;
  description: string;
  basePrice: string;
  hasFrame: boolean;
  isActive: boolean;
  sortOrder: string;
  bleedMm: string;
};

function AttrsPanel({
  product,
  categories,
}: {
  product: Product;
  categories: CategoryTreeNode[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<AttrsForm>({
    name: product.name,
    categoryId: product.categoryId as string,
    tagline: product.tagline,
    description: product.description,
    basePrice: String(product.basePrice),
    hasFrame: product.hasFrame,
    isActive: product.isActive,
    sortOrder: String(product.sortOrder),
    bleedMm: String(product.bleedMm ?? 0),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const categoryOptions = flattenCategories(categories);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const fd = new FormData();
      fd.append('id', product.id as string);
      fd.append('name', form.name);
      fd.append('categoryId', form.categoryId);
      fd.append('tagline', form.tagline);
      fd.append('description', form.description);
      fd.append('basePrice', form.basePrice);
      fd.append('hasFrame', String(form.hasFrame));
      fd.append('isActive', String(form.isActive));
      fd.append('sortOrder', form.sortOrder);
      fd.append('bleedMm', form.bleedMm);
      // productType 미전송 — upsertProduct 가 컬럼을 건드리지 않는다(유형 탭 전담).

      const result = await upsertProductAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card padding="md">
      <form onSubmit={handleSubmit} className="space-y-3 max-w-xl">
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
            placeholder="상품 상세 설명"
            rows={4}
            maxLength={50000}
            className="w-full border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:border-foreground resize-y"
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
              className="w-4 h-4"
            />
            <span>프레임 유무</span>
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="w-4 h-4"
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

        <Input
          label="인쇄 블리드 (mm)"
          type="number"
          min={0}
          max={50}
          step={0.5}
          value={form.bleedMm}
          onChange={(e) => setForm({ ...form, bleedMm: e.target.value })}
          hint="인쇄 영역(점선) 바깥으로 확장해 크롭할 여백. 재단 오차 보정용. 0 = 여백 없음."
        />

        {error ? (
          <div role="alert" className="text-sm text-danger border border-danger px-3 py-2">
            {error}
          </div>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-success">
            저장되었습니다.
          </p>
        ) : null}

        <Button type="submit" loading={pending} disabled={pending}>
          저장
        </Button>
      </form>
    </Card>
  );
}

// ---------- Workspace shell ----------

export function WorkspaceClient({
  product,
  categories,
  frames,
  variants,
  setTemplates,
  bundleRule,
  setTemplatesAvailable,
  bundleRulesAvailable,
}: Props) {
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('type');

  const productType = product.productType ?? 'single';
  const tabs = visibleWorkspaceTabs({
    productType,
    setTemplatesAvailable,
    bundleRulesAvailable,
  });
  const hasExtendedAssets = setTemplates.length > 0 || bundleRule != null;

  // 유형 전환 등으로 탭이 사라진 경우(예: extended→single 후 refresh) 폴백.
  const active = tabs.some((t) => t.id === activeTab && !t.disabled)
    ? activeTab
    : 'type';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{product.name}</h2>
        <span className="text-xs text-muted-fg font-mono">{product.id as string}</span>
      </div>

      <div
        role="tablist"
        aria-label="상품 워크스페이스 탭"
        className="flex gap-1 border-b border-border overflow-x-auto"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            disabled={tab.disabled}
            title={tab.disabledReason}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`workspace-tab-${tab.id}`}
            className={cn(
              'px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
              active === tab.id
                ? 'border-foreground font-semibold text-foreground'
                : 'border-transparent text-muted-fg hover:text-foreground',
              tab.disabled && 'opacity-40 cursor-not-allowed',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'type' ? (
        <TypePanel product={product} hasExtendedAssets={hasExtendedAssets} />
      ) : null}

      {active === 'attrs' ? (
        <AttrsPanel product={product} categories={categories} />
      ) : null}

      {active === 'frames' ? (
        <FramesClient
          products={[product]}
          selectedProductId={product.id as string}
          frames={frames}
          embedded
        />
      ) : null}

      {active === 'options' ? (
        <OptionsClient
          products={[product]}
          selectedProductId={product.id as string}
          variants={variants}
          embedded
        />
      ) : null}

      {active === 'bundleRule' ? (
        <BundleRuleForm
          productId={product.id as string}
          rule={bundleRule}
          variants={variants}
        />
      ) : null}

      {active === 'setTemplates' ? (
        <SetTemplatesPanel
          productId={product.id as string}
          templates={setTemplates}
          variants={variants}
          frames={frames}
        />
      ) : null}
    </div>
  );
}
