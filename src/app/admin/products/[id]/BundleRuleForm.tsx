'use client';

/**
 * 구성 규칙(bundle_rules) 폼 — 상품 1:1 (FS-X-03, 탭4).
 *
 * bundleRuleInputSchema(SSOT)에 맞춰 min/max 슬롯, 허용 사이즈/방향(빈 선택 =
 * 제한 없음), mix 3토글, 가격 전략(+ 조건 필드)을 편집한다.
 * ※ ADR-026: 가격 전략은 저장까지만 — createOrder 적용은 후속 웨이브.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { ProductVariant } from '@/types/product';
import type { Orientation } from '@/types/project';
import type { BundleRule, PricingStrategy } from '@/types/set';
import { upsertBundleRuleAction } from './actions';

type Props = {
  productId: string;
  rule: BundleRule | null;
  variants: ProductVariant[];
};

const ORIENTATION_LABELS: Array<{ value: Orientation; label: string }> = [
  { value: 'portrait', label: '세로 (portrait)' },
  { value: 'landscape', label: '가로 (landscape)' },
];

const STRATEGY_OPTIONS = [
  { value: 'sum', label: 'sum — 라인 합산 (현행)' },
  { value: 'sum_with_discount', label: 'sum_with_discount — 합산 후 할인' },
  { value: 'flat', label: 'flat — 세트 고정가' },
];

type FormState = {
  minSlots: string;
  maxSlots: string;
  allowedSizeCodes: string[];
  allowedOrientations: Orientation[];
  allowSizeMix: boolean;
  allowOrientationMix: boolean;
  allowPhotoReuse: boolean;
  pricingStrategy: PricingStrategy;
  discountBps: string;
  flatPrice: string;
  isActive: boolean;
};

function ruleToForm(rule: BundleRule | null): FormState {
  return {
    minSlots: String(rule?.minSlots ?? 1),
    maxSlots: String(rule?.maxSlots ?? 4),
    allowedSizeCodes: rule?.allowedSizeCodes ?? [],
    allowedOrientations: rule?.allowedOrientations ?? [],
    allowSizeMix: rule?.allowSizeMix ?? true,
    allowOrientationMix: rule?.allowOrientationMix ?? true,
    allowPhotoReuse: rule?.allowPhotoReuse ?? true,
    pricingStrategy: rule?.pricingStrategy ?? 'sum',
    discountBps: rule?.discountBps != null ? String(rule.discountBps) : '',
    flatPrice: rule?.flatPrice != null ? String(rule.flatPrice) : '',
    isActive: rule?.isActive ?? true,
  };
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function BundleRuleForm({ productId, rule, variants }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => ruleToForm(rule));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // 옵션 매트릭스의 사이즈 어휘(중복 제거, 정렬 유지).
  const sizeCodes = useMemo(() => {
    const seen = new Set<string>();
    const codes: Array<{ code: string; label: string }> = [];
    for (const v of variants) {
      if (seen.has(v.sizeCode)) continue;
      seen.add(v.sizeCode);
      codes.push({ code: v.sizeCode, label: `${v.sizeCode} (${v.sizeLabel})` });
    }
    return codes;
  }, [variants]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const minSlots = Number(form.minSlots);
    const maxSlots = Number(form.maxSlots);
    if (!Number.isInteger(minSlots) || !Number.isInteger(maxSlots)) {
      setError('슬롯 수는 정수여야 합니다.');
      return;
    }
    if (maxSlots < minSlots) {
      setError('최대 슬롯은 최소 슬롯 이상이어야 합니다.');
      return;
    }
    if (form.pricingStrategy === 'sum_with_discount' && form.discountBps.trim() === '') {
      setError('sum_with_discount 전략은 할인(bps)이 필요합니다.');
      return;
    }
    if (form.pricingStrategy === 'flat' && form.flatPrice.trim() === '') {
      setError('flat 전략은 고정가(원)가 필요합니다.');
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.append('productId', productId);
      fd.append('minSlots', form.minSlots);
      fd.append('maxSlots', form.maxSlots);
      for (const code of form.allowedSizeCodes) fd.append('allowedSizeCodes', code);
      for (const o of form.allowedOrientations) fd.append('allowedOrientations', o);
      fd.append('allowSizeMix', String(form.allowSizeMix));
      fd.append('allowOrientationMix', String(form.allowOrientationMix));
      fd.append('allowPhotoReuse', String(form.allowPhotoReuse));
      fd.append('pricingStrategy', form.pricingStrategy);
      if (form.pricingStrategy === 'sum_with_discount') {
        fd.append('discountBps', form.discountBps);
      }
      if (form.pricingStrategy === 'flat') {
        fd.append('flatPrice', form.flatPrice);
      }
      fd.append('isActive', String(form.isActive));

      const result = await upsertBundleRuleAction(fd);
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
      <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">구성 규칙</h3>
          <p className="text-xs text-muted-fg">
            확장형 편집기의 구성 검증 규칙입니다. 가격 전략은 저장만 되며 주문
            계산에는 아직 적용되지 않습니다 (ADR-026).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="최소 슬롯 (min_slots)"
            type="number"
            min={1}
            max={50}
            value={form.minSlots}
            onChange={(e) => setForm({ ...form, minSlots: e.target.value })}
            required
          />
          <Input
            label="최대 슬롯 (max_slots)"
            type="number"
            min={1}
            max={50}
            value={form.maxSlots}
            onChange={(e) => setForm({ ...form, maxSlots: e.target.value })}
            required
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">
            허용 사이즈 <span className="text-xs text-muted-fg">(미선택 = 전체 허용)</span>
          </legend>
          {sizeCodes.length === 0 ? (
            <p className="text-xs text-muted-fg">
              옵션 탭에서 변형을 먼저 등록하면 사이즈 목록이 나타납니다.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {sizeCodes.map((s) => (
                <label key={s.code} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.allowedSizeCodes.includes(s.code)}
                    onChange={() =>
                      setForm({
                        ...form,
                        allowedSizeCodes: toggleInList(form.allowedSizeCodes, s.code),
                      })
                    }
                    className="w-4 h-4"
                  />
                  <span className="font-mono">{s.label}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">
            허용 방향 <span className="text-xs text-muted-fg">(미선택 = 전체 허용)</span>
          </legend>
          <div className="flex flex-wrap gap-3">
            {ORIENTATION_LABELS.map((o) => (
              <label key={o.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allowedOrientations.includes(o.value)}
                  onChange={() =>
                    setForm({
                      ...form,
                      allowedOrientations: toggleInList(form.allowedOrientations, o.value),
                    })
                  }
                  className="w-4 h-4"
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">혼합 허용</legend>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowSizeMix}
                onChange={(e) => setForm({ ...form, allowSizeMix: e.target.checked })}
                className="w-4 h-4"
              />
              <span>사이즈 혼합 허용 (allow_size_mix)</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowOrientationMix}
                onChange={(e) =>
                  setForm({ ...form, allowOrientationMix: e.target.checked })
                }
                className="w-4 h-4"
              />
              <span>방향 혼합 허용 (allow_orientation_mix)</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowPhotoReuse}
                onChange={(e) => setForm({ ...form, allowPhotoReuse: e.target.checked })}
                className="w-4 h-4"
              />
              <span>같은 사진 재사용 허용 (allow_photo_reuse)</span>
            </label>
          </div>
        </fieldset>

        <Select
          label="가격 전략 (pricing_strategy)"
          value={form.pricingStrategy}
          onChange={(e) =>
            setForm({ ...form, pricingStrategy: e.target.value as PricingStrategy })
          }
          options={STRATEGY_OPTIONS}
        />

        {form.pricingStrategy === 'sum_with_discount' ? (
          <Input
            label="할인 (bps, 10000 = 100%)"
            type="number"
            min={0}
            max={10000}
            value={form.discountBps}
            onChange={(e) => setForm({ ...form, discountBps: e.target.value })}
            required
            hint="예: 1000 = 10% 할인"
          />
        ) : null}

        {form.pricingStrategy === 'flat' ? (
          <Input
            label="세트 고정가 (원)"
            type="number"
            min={0}
            value={form.flatPrice}
            onChange={(e) => setForm({ ...form, flatPrice: e.target.value })}
            required
          />
        ) : null}

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
        {saved ? (
          <p role="status" className="text-sm text-success">
            저장되었습니다.
          </p>
        ) : null}

        <Button type="submit" loading={pending} disabled={pending} data-testid="bundle-rule-save-btn">
          규칙 저장
        </Button>
      </form>
    </Card>
  );
}
