'use client';

/**
 * 쿠폰 관리 클라이언트 (FS-X-05, ADR-026).
 *
 * 목록 테이블(코드/유형/값/사용량/만료/활성) + 생성·수정 Dialog + 활성 토글 +
 * 삭제. 폼은 couponInputSchema 로 클라이언트 선검증(즉시 피드백)하고, 서버
 * 액션이 같은 스키마로 재검증한다(신뢰 경계는 서버).
 *
 * percent 표시 변환: DB/계약 값은 bps(10000 = 100%) — 폼에는 %로 보여주고
 * 저장 시 bps 로 되돌린다(couponFormToInput / bpsToPercent, 테스트용 export).
 */

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { couponInputSchema } from '@/types/coupon';
import type { Coupon, CouponType } from '@/types/coupon';
import {
  deleteCouponAction,
  saveCouponAction,
  toggleCouponActiveAction,
} from './actions';

// ---------- 순수 변환 헬퍼 (테스트용 export) ----------

/** bps → % (표시용). 1000bps = 10%. */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/** % → bps (저장용). 소수 % 입력(0.01% 단위)까지 반올림 수용. */
export function percentToBps(pct: number): number {
  return Math.round(pct * 100);
}

/** 목록 표시용 값 라벨 — fixed 는 원, percent 는 %. */
export function couponValueLabel(
  coupon: Pick<Coupon, 'type' | 'value'>,
): string {
  return coupon.type === 'fixed'
    ? `${coupon.value.toLocaleString('ko-KR')}원`
    : `${bpsToPercent(coupon.value)}%`;
}

export type CouponFormState = {
  id?: string;
  code: string;
  type: CouponType;
  /** fixed: 원 / percent: % (문자열 — 폼 입력값 그대로). */
  value: string;
  minSubtotal: string;
  /** date input 값. '' = 무기한. */
  expiresAt: string;
  /** '' = 무제한. */
  usageLimit: string;
  isActive: boolean;
};

/**
 * 폼 상태 → couponInputSchema 입력(percent 는 % → bps 변환). zod 검증 전
 * 원시 변환만 담당 — NaN 등은 스키마가 거부한다(순수 함수, 테스트용 export).
 */
export function couponFormToInput(form: CouponFormState): {
  code: string;
  type: CouponType;
  value: number;
  minSubtotal: number;
  expiresAt: string | null;
  usageLimit: number | null;
  isActive: boolean;
} {
  const rawValue = Number(form.value);
  return {
    code: form.code.trim(),
    type: form.type,
    value:
      form.type === 'percent' ? percentToBps(rawValue) : Math.round(rawValue),
    minSubtotal:
      form.minSubtotal.trim() === '' ? 0 : Math.round(Number(form.minSubtotal)),
    expiresAt: form.expiresAt.trim() === '' ? null : form.expiresAt,
    usageLimit:
      form.usageLimit.trim() === '' ? null : Math.round(Number(form.usageLimit)),
    isActive: form.isActive,
  };
}

function couponToForm(coupon: Coupon): CouponFormState {
  return {
    id: coupon.id as string,
    code: coupon.code,
    type: coupon.type,
    value:
      coupon.type === 'percent'
        ? String(bpsToPercent(coupon.value))
        : String(coupon.value),
    minSubtotal: String(coupon.minSubtotal),
    // date input 은 YYYY-MM-DD 만 수용 — ISO 타임스탬프에서 날짜부만 취한다.
    expiresAt: coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : '',
    usageLimit: coupon.usageLimit != null ? String(coupon.usageLimit) : '',
    isActive: coupon.isActive,
  };
}

const EMPTY_FORM: CouponFormState = {
  code: '',
  type: 'fixed',
  value: '',
  minSubtotal: '0',
  expiresAt: '',
  usageLimit: '',
  isActive: true,
};

const TYPE_OPTIONS = [
  { value: 'fixed', label: '정액(원)' },
  { value: 'percent', label: '정률(%)' },
];

// ---------- 컴포넌트 ----------

type Props = { coupons: Coupon[] };

export function CouponsClient({ coupons }: Props) {
  const [rows, setRows] = useState<Coupon[]>(coupons);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CouponFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setOpen(true);
  }

  function openEdit(coupon: Coupon) {
    setForm(couponToForm(coupon));
    setFormError(null);
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const input = couponFormToInput(form);
    const parsed = couponInputSchema.safeParse(input);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? '입력을 확인해주세요.');
      return;
    }

    startTransition(async () => {
      const result = await saveCouponAction({
        ...parsed.data,
        ...(form.id ? { id: form.id } : {}),
      });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setRows((prev) => {
        const idx = prev.findIndex((c) => c.id === result.coupon.id);
        if (idx === -1) return [result.coupon, ...prev];
        const next = [...prev];
        next[idx] = result.coupon;
        return next;
      });
      setOpen(false);
      setForm(EMPTY_FORM);
    });
  }

  function handleToggle(coupon: Coupon) {
    setListError(null);
    setBusyId(coupon.id as string);
    startTransition(async () => {
      const result = await toggleCouponActiveAction(
        coupon.id as string,
        !coupon.isActive,
      );
      if (result.ok) {
        setRows((prev) =>
          prev.map((c) => (c.id === result.coupon.id ? result.coupon : c)),
        );
      } else {
        setListError(result.error);
      }
      setBusyId(null);
    });
  }

  function handleDelete(coupon: Coupon) {
    if (
      !window.confirm(
        `쿠폰 ${coupon.code} 을(를) 삭제합니다. 사용 이력이 있으면 삭제되지 않습니다. 계속할까요?`,
      )
    ) {
      return;
    }
    setListError(null);
    setBusyId(coupon.id as string);
    startTransition(async () => {
      const result = await deleteCouponAction(coupon.id as string);
      if (result.ok) {
        setRows((prev) => prev.filter((c) => c.id !== coupon.id));
      } else {
        // 사용 이력 있는 쿠폰 등 — 서버 안내 메시지를 그대로 노출.
        setListError(result.error);
      }
      setBusyId(null);
    });
  }

  const isPercent = form.type === 'percent';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>쿠폰 생성</Button>
      </div>

      {listError ? (
        <p role="alert" className="text-sm text-danger border border-danger rounded-md px-3 py-2">
          {listError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-fg text-center py-8">
          등록된 쿠폰이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left">
                <th className="px-3 py-2 font-medium">코드</th>
                <th className="px-3 py-2 font-medium">유형</th>
                <th className="px-3 py-2 font-medium">값</th>
                <th className="px-3 py-2 font-medium">최소금액</th>
                <th className="px-3 py-2 font-medium">사용량</th>
                <th className="px-3 py-2 font-medium">만료</th>
                <th className="px-3 py-2 font-medium">활성</th>
                <th className="px-3 py-2 font-medium text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((coupon) => {
                const busy = busyId === (coupon.id as string);
                return (
                  <tr key={coupon.id as string} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-mono">{coupon.code}</td>
                    <td className="px-3 py-2">
                      {coupon.type === 'fixed' ? '정액' : '정률'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {couponValueLabel(coupon)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {coupon.minSubtotal > 0
                        ? `${coupon.minSubtotal.toLocaleString('ko-KR')}원`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {coupon.usedCount} /{' '}
                      {coupon.usageLimit != null ? coupon.usageLimit : '무제한'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {coupon.expiresAt
                        ? new Date(coupon.expiresAt).toLocaleDateString('ko-KR')
                        : '무기한'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={coupon.isActive ? 'success' : 'default'}>
                        {coupon.isActive ? '활성' : '비활성'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || pending}
                          onClick={() => openEdit(coupon)}
                        >
                          수정
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || pending}
                          loading={busy}
                          onClick={() => handleToggle(coupon)}
                        >
                          {coupon.isActive ? '비활성화' : '활성화'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || pending}
                          onClick={() => handleDelete(coupon)}
                        >
                          삭제
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={form.id ? '쿠폰 수정' : '쿠폰 생성'}
        description="percent 쿠폰의 값은 %로 입력합니다 (저장은 bps)."
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            label="코드"
            placeholder="WELCOME10"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            hint="영문/숫자/하이픈/언더스코어 2~30자 — 대문자로 정규화 저장"
            disabled={pending}
            required
          />
          <Select
            label="유형"
            options={TYPE_OPTIONS}
            value={form.type}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as CouponType, value: '' })
            }
            disabled={pending}
          />
          <Input
            label={isPercent ? '할인율(%)' : '할인 금액(원)'}
            type="number"
            min={isPercent ? 0.01 : 1}
            max={isPercent ? 100 : undefined}
            step={isPercent ? 0.01 : 1}
            placeholder={isPercent ? '10 (= 10%)' : '3000'}
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            disabled={pending}
            required
          />
          <Input
            label="최소 주문금액(원)"
            type="number"
            min={0}
            step={1}
            value={form.minSubtotal}
            onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })}
            hint="0 = 제한 없음"
            disabled={pending}
          />
          <Input
            label="만료일"
            type="date"
            value={form.expiresAt}
            onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            hint="비우면 무기한"
            disabled={pending}
          />
          <Input
            label="전체 사용 한도"
            type="number"
            min={1}
            step={1}
            placeholder="무제한"
            value={form.usageLimit}
            onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
            hint="비우면 무제한 (회원 1인 1회 제한은 별개로 항상 적용)"
            disabled={pending}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              disabled={pending}
            />
            활성
          </label>

          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}

          <div className="flex gap-2 justify-end pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              취소
            </Button>
            <Button type="submit" loading={pending} disabled={pending}>
              저장
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
