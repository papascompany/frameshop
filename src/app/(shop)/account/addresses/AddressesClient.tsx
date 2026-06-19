'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { PostcodeButton } from '@/components/PostcodeButton';
import { formatPhone } from '@/lib/checkout/validate';
import type { AddressInput, UserAddress } from '@/types/address';

// ── 폼 상태 ─────────────────────────────────────────────────────────────────────

type FormState = {
  label: string;
  recipientName: string;
  phone: string;
  zip: string;
  addr1: string;
  addr2: string;
  memo: string;
  isDefault: boolean;
};

const EMPTY_FORM: FormState = {
  label: '',
  recipientName: '',
  phone: '',
  zip: '',
  addr1: '',
  addr2: '',
  memo: '',
  isDefault: false,
};

function formFromAddress(a: UserAddress): FormState {
  return {
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    zip: a.zip,
    addr1: a.addr1,
    addr2: a.addr2,
    memo: a.memo,
    isDefault: a.isDefault,
  };
}

/**
 * 폼을 API 입력(addressInputSchema)으로 변환. 선택 항목 중 빈 문자열은 그대로
 * 전송해도 DB 레이어가 ''로 정규화하므로 무방하나, 검증을 단순하게 유지하기
 * 위해 필수 필드만 trim 합니다.
 */
function toInput(form: FormState): AddressInput {
  return {
    label: form.label.trim(),
    recipientName: form.recipientName.trim(),
    phone: form.phone.trim(),
    zip: form.zip.trim(),
    addr1: form.addr1.trim(),
    addr2: form.addr2.trim(),
    memo: form.memo.trim(),
    isDefault: form.isDefault,
  };
}

// addressInputSchema 와 동일한 규칙으로 클라이언트 측 사전 검증.
const PHONE_RE = /^01[0-9]-\d{3,4}-\d{4}$/;
const ZIP_RE = /^\d{5}$/;

type FieldErrors = Partial<Record<keyof FormState, string>>;

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.recipientName.trim()) {
    errors.recipientName = '받는 분 이름을 입력해 주세요.';
  } else if (form.recipientName.trim().length > 30) {
    errors.recipientName = '이름은 30자 이내로 입력해 주세요.';
  }
  if (!PHONE_RE.test(form.phone.trim())) {
    errors.phone = '연락처를 010-1234-5678 형식으로 입력해 주세요.';
  }
  if (!ZIP_RE.test(form.zip.trim())) {
    errors.zip = '우편번호를 검색해 주세요.';
  }
  if (!form.addr1.trim()) {
    errors.addr1 = '주소를 검색해 주세요.';
  } else if (form.addr1.trim().length > 100) {
    errors.addr1 = '주소가 너무 깁니다.';
  }
  if (form.label.trim().length > 30) {
    errors.label = '별칭은 30자 이내로 입력해 주세요.';
  }
  if (form.addr2.trim().length > 80) {
    errors.addr2 = '상세주소는 80자 이내로 입력해 주세요.';
  }
  if (form.memo.trim().length > 200) {
    errors.memo = '배송 메모는 200자 이내로 입력해 주세요.';
  }
  return errors;
}

// ── 주소 입력 폼 다이얼로그 ──────────────────────────────────────────────────────

type AddressFormDialogProps = {
  open: boolean;
  /** 편집 대상. null 이면 신규 추가. */
  target: UserAddress | null;
  onClose: () => void;
  onSaved: (address: UserAddress) => void;
};

function AddressFormDialog({ open, target, onClose, onSaved }: AddressFormDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 다이얼로그가 열릴 때마다 대상에 맞춰 폼을 초기화 (Dialog 는 닫혀도 마운트 유지).
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? (target ? (target.id as string) : 'new') : null;
  if (seedKey !== null && seedKey !== seededFor) {
    setForm(target ? formFromAddress(target) : EMPTY_FORM);
    setErrors({});
    setSubmitError(null);
    setSeededFor(seedKey);
  } else if (seedKey === null && seededFor !== null) {
    setSeededFor(null);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const isEdit = target !== null;
      const url = isEdit
        ? `/api/account/addresses/${target.id as string}`
        : '/api/account/addresses';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toInput(form)),
      });
      const data = (await res.json()) as {
        ok: boolean;
        address?: UserAddress;
        code?: string;
      };
      if (!res.ok || !data.ok || !data.address) {
        setSubmitError(
          data.code === 'RATE_LIMITED'
            ? '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'
            : '저장에 실패했습니다. 입력 내용을 확인하고 다시 시도해 주세요.',
        );
        return;
      }
      onSaved(data.address);
    } catch {
      setSubmitError('네트워크 오류로 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
      title={target ? '배송지 수정' : '새 배송지 추가'}
      maxWidth="max-w-lg"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={onClose}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={submitting}
            disabled={submitting}
            onClick={() => void handleSubmit()}
          >
            저장
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <Input
          label="배송지 별칭 (선택)"
          value={form.label}
          onChange={(e) => update('label', e.target.value)}
          error={errors.label}
          placeholder="집, 회사 등"
          maxLength={30}
        />
        <Input
          label="받는 분"
          value={form.recipientName}
          onChange={(e) => update('recipientName', e.target.value)}
          error={errors.recipientName}
          autoComplete="name"
          maxLength={30}
        />
        <Input
          label="연락처"
          value={form.phone}
          onChange={(e) => update('phone', formatPhone(e.target.value))}
          error={errors.phone}
          placeholder="010-1234-5678"
          inputMode="numeric"
          autoComplete="tel"
        />
        <div className="space-y-1.5">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="우편번호"
                value={form.zip}
                readOnly
                error={errors.zip}
                placeholder="우편번호 검색"
                autoComplete="postal-code"
              />
            </div>
            <PostcodeButton
              onComplete={(zip, addr1) => {
                update('zip', zip);
                update('addr1', addr1);
                setErrors((prev) => ({ ...prev, zip: undefined, addr1: undefined }));
              }}
            />
          </div>
        </div>
        <Input
          label="주소"
          value={form.addr1}
          readOnly
          error={errors.addr1}
          placeholder="주소 검색 버튼을 눌러주세요"
          autoComplete="address-line1"
        />
        <Input
          label="상세주소 (선택)"
          value={form.addr2}
          onChange={(e) => update('addr2', e.target.value)}
          error={errors.addr2}
          placeholder="동/호수 등"
          autoComplete="address-line2"
          maxLength={80}
        />
        <Input
          label="배송 메모 (선택)"
          value={form.memo}
          onChange={(e) => update('memo', e.target.value)}
          error={errors.memo}
          placeholder="부재 시 문 앞에 놓아주세요 등"
          maxLength={200}
        />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => update('isDefault', e.target.checked)}
            className="h-4 w-4 rounded border-border accent-ink"
          />
          기본 배송지로 설정
        </label>

        {submitError ? (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        ) : null}
        {/* 엔터 제출 지원용 숨김 버튼 */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

// ── 삭제 확인 다이얼로그 ─────────────────────────────────────────────────────────

type DeleteDialogProps = {
  target: UserAddress | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function DeleteDialog({ target, pending, error, onCancel, onConfirm }: DeleteDialogProps) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
      title="배송지 삭제"
      description={
        target
          ? `'${target.label || target.recipientName}' 배송지를 삭제하시겠습니까?`
          : undefined
      }
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
            취소
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
          >
            삭제
          </Button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : (
        <p className="text-sm text-muted-fg">삭제한 배송지는 복구할 수 없습니다.</p>
      )}
    </Dialog>
  );
}

// ── AddressesClient ─────────────────────────────────────────────────────────────

type Props = {
  initialAddresses: UserAddress[];
};

export function AddressesClient({ initialAddresses }: Props) {
  const [addresses, setAddresses] = useState<UserAddress[]>(initialAddresses);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserAddress | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<UserAddress | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 기본 설정 진행 중인 주소 id (버튼 로딩 표시용).
  const [defaultPendingId, setDefaultPendingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  /** 정렬: 기본 배송지 우선, 그 다음 최신순(생성일 내림차순). */
  function sortAddresses(list: UserAddress[]): UserAddress[] {
    return [...list].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  /** 저장된 주소를 로컬 목록에 병합. isDefault 승격 시 다른 항목의 플래그 해제. */
  function upsert(saved: UserAddress) {
    setAddresses((prev) => {
      const cleared = saved.isDefault
        ? prev.map((a) => (a.id === saved.id ? a : { ...a, isDefault: false }))
        : prev;
      const exists = cleared.some((a) => a.id === saved.id);
      const next = exists
        ? cleared.map((a) => (a.id === saved.id ? saved : a))
        : [...cleared, saved];
      return sortAddresses(next);
    });
  }

  function openAdd() {
    setEditTarget(null);
    setFormOpen(true);
  }

  function openEdit(address: UserAddress) {
    setEditTarget(address);
    setFormOpen(true);
  }

  function handleSaved(address: UserAddress) {
    upsert(address);
    setFormOpen(false);
    setEditTarget(null);
  }

  async function handleSetDefault(address: UserAddress) {
    if (address.isDefault) return;
    setDefaultPendingId(address.id as string);
    setListError(null);
    try {
      // 전용 set-default 엔드포인트가 없으므로 PATCH 에 전체 필드 + isDefault 전달.
      const res = await fetch(`/api/account/addresses/${address.id as string}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: address.label,
          recipientName: address.recipientName,
          phone: address.phone,
          zip: address.zip,
          addr1: address.addr1,
          addr2: address.addr2,
          memo: address.memo,
          isDefault: true,
        } satisfies AddressInput),
      });
      const data = (await res.json()) as { ok: boolean; address?: UserAddress };
      if (!res.ok || !data.ok || !data.address) {
        setListError('기본 배송지 설정에 실패했습니다. 다시 시도해 주세요.');
        return;
      }
      upsert(data.address);
    } catch {
      setListError('네트워크 오류로 기본 배송지를 설정하지 못했습니다.');
    } finally {
      setDefaultPendingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/account/addresses/${deleteTarget.id as string}`, {
        method: 'DELETE',
      });
      const data = (await res.json()) as { ok: boolean };
      if (!res.ok || !data.ok) {
        setDeleteError('삭제에 실패했습니다. 다시 시도해 주세요.');
        return;
      }
      const removedId = deleteTarget.id;
      setAddresses((prev) => prev.filter((a) => a.id !== removedId));
      setDeleteTarget(null);
    } catch {
      setDeleteError('네트워크 오류로 삭제하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" variant="primary" size="sm" onClick={openAdd}>
          새 배송지 추가
        </Button>
      </div>

      {listError ? (
        <p role="alert" className="text-sm text-danger border border-danger rounded-md px-3 py-2">
          {listError}
        </p>
      ) : null}

      {addresses.length === 0 ? (
        <div className="text-center py-16 text-muted-fg">
          <p className="text-sm">저장된 배송지가 없습니다.</p>
          <p className="mt-2 text-xs">
            자주 사용하는 배송지를 등록하면 주문 시 빠르게 선택할 수 있습니다.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {addresses.map((address) => {
            const isSettingDefault = defaultPendingId === (address.id as string);
            return (
              <li key={address.id as string}>
                <Card padding="md" className="space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {address.label ? (
                          <span className="text-sm font-semibold text-foreground">
                            {address.label}
                          </span>
                        ) : null}
                        {address.isDefault ? (
                          <Badge variant="success">기본 배송지</Badge>
                        ) : null}
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {address.recipientName}{' '}
                        <span className="text-muted-fg tabular-nums">{address.phone}</span>
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-border pt-3 space-y-0.5 text-sm text-foreground">
                    <p>
                      <span className="text-muted-fg tabular-nums mr-1">[{address.zip}]</span>
                      {address.addr1}
                    </p>
                    {address.addr2 ? <p>{address.addr2}</p> : null}
                    {address.memo ? (
                      <p className="text-xs text-muted-fg pt-1">메모: {address.memo}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-3 flex-wrap gap-2">
                    <div>
                      {address.isDefault ? null : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          loading={isSettingDefault}
                          disabled={isSettingDefault}
                          onClick={() => void handleSetDefault(address)}
                        >
                          기본으로 설정
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => openEdit(address)}
                      >
                        수정
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(address);
                        }}
                      >
                        삭제
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <AddressFormDialog
        open={formOpen}
        target={editTarget}
        onClose={() => {
          setFormOpen(false);
          setEditTarget(null);
        }}
        onSaved={handleSaved}
      />

      <DeleteDialog
        target={deleteTarget}
        pending={deletePending}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
