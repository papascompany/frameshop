/**
 * inquiries — 1:1 문의 데이터 접근 (FS-X-02, migration 040 / ADR-026).
 *
 * Server-only. Uses the service-role client, which BYPASSES RLS — therefore
 * ownership is enforced *in code*: member reads are scoped by `user_id`, and
 * writes inject the verified session user id (never a client-supplied one).
 * RLS (owner-select / own-insert on the table) remains defence-in-depth.
 *
 * Probe-graceful (배포~마이그 적용 창): every entry point checks
 * `isInquiriesAvailable()` first — reads degrade to an empty list, writes
 * return an explicit `INQUIRIES_UNAVAILABLE` error value (42P01 never leaks).
 */

import 'server-only';
import { asBrand } from '@/types/common';
import type { InquiryId, OrderId, ProductId, UserId } from '@/types/common';
import type { Inquiry, InquiryInput, InquiryStatus } from '@/types/inquiry';
import { isInquiriesAvailable } from './feature-probe';
import { getServiceRoleSupabase } from '../supabase/service';

// ---------- row shape + mapper ----------

const INQUIRY_COLUMNS =
  'id, user_id, order_id, product_id, contact_email, category, subject, body, status, admin_reply, answered_at, created_at';

type InquiryRow = {
  id: string;
  user_id: string | null;
  order_id: string | null;
  product_id: string | null;
  contact_email: string;
  category: string | null;
  subject: string;
  body: string;
  /** DB CHECK guarantees one of INQUIRY_STATUSES. */
  status: string;
  admin_reply: string | null;
  answered_at: string | null;
  created_at: string;
};

function mapInquiry(row: InquiryRow): Inquiry {
  return {
    id: asBrand<InquiryId>(row.id),
    userId: row.user_id ? asBrand<UserId>(row.user_id) : null,
    orderId: row.order_id ? asBrand<OrderId>(row.order_id) : null,
    productId: row.product_id ? asBrand<ProductId>(row.product_id) : null,
    contactEmail: row.contact_email,
    category: row.category,
    subject: row.subject,
    body: row.body,
    status: row.status as InquiryStatus,
    adminReply: row.admin_reply,
    answeredAt: row.answered_at,
    createdAt: row.created_at,
  };
}

// ---------- result tuple ----------

type DbResult<T> = { data: T; error: null } | { data: null; error: string };

/** 미적용 창의 쓰기 거부 코드 — 라우트/액션이 503/명시 메시지로 매핑한다. */
export const INQUIRIES_UNAVAILABLE = 'INQUIRIES_UNAVAILABLE';

// ---------- member reads/writes (always scoped by userId) ----------

/** 내 문의 목록, 최신순. 미적용이면 빈 목록(그레이스풀). */
export async function listMyInquiries(
  userId: UserId,
): Promise<DbResult<Inquiry[]>> {
  if (!(await isInquiriesAvailable())) return { data: [], error: null };

  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('inquiries')
    .select(INQUIRY_COLUMNS)
    .eq('user_id', userId as string)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return { data: null, error: error.message };
  return { data: ((data ?? []) as InquiryRow[]).map(mapInquiry), error: null };
}

/**
 * 회원 문의 작성. `user_id` 는 항상 검증된 세션 사용자 — input 에는 존재하지
 * 않아 스푸핑이 불가능하다. contact_email 폴백(입력 or 세션 이메일)은 라우트가
 * zod parse 전에 주입한다(스키마상 contactEmail 필수 — FROZEN 계약 유지).
 */
export async function createInquiry(
  userId: UserId,
  input: InquiryInput,
): Promise<DbResult<Inquiry>> {
  if (!(await isInquiriesAvailable())) {
    return { data: null, error: INQUIRIES_UNAVAILABLE };
  }

  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('inquiries')
    .insert({
      user_id: userId as string,
      order_id: input.orderId ?? null,
      product_id: input.productId ?? null,
      contact_email: input.contactEmail,
      category: input.category ?? null,
      subject: input.subject,
      body: input.body,
    })
    .select(INQUIRY_COLUMNS)
    .single();

  if (error || !data) {
    // FK 위반(존재하지 않는 order/product 참조)은 입력 오류로 구분해 라우트가
    // 500 대신 422 로 응답할 수 있게 한다.
    if (error?.code === '23503') return { data: null, error: 'REF_NOT_FOUND' };
    return { data: null, error: error?.message ?? 'createInquiry: insert failed' };
  }
  return { data: mapInquiry(data as InquiryRow), error: null };
}

// ---------- admin (service-role — caller must gate with requireAdmin) ----------

/** 전체 문의 목록(관리자), 최신순 + 선택적 상태 필터. 미적용이면 빈 목록. */
export async function getAllInquiries(
  limit = 50,
  statusFilter?: InquiryStatus,
): Promise<DbResult<Inquiry[]>> {
  if (!(await isInquiriesAvailable())) return { data: [], error: null };

  const supabase = getServiceRoleSupabase();
  let query = supabase
    .from('inquiries')
    .select(INQUIRY_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: ((data ?? []) as InquiryRow[]).map(mapInquiry), error: null };
}

/**
 * 관리자 답변 등록 — 상태 전이 OPEN → ANSWERED 를 원자적으로 수행한다
 * (admin_reply + status + answered_at 을 한 UPDATE 로). 재답변(내용 수정)도
 * 같은 경로 — answered_at 은 마지막 답변 시각으로 갱신된다.
 */
export async function replyToInquiry(
  inquiryId: InquiryId,
  replyText: string,
): Promise<DbResult<Inquiry>> {
  if (!(await isInquiriesAvailable())) {
    return { data: null, error: INQUIRIES_UNAVAILABLE };
  }

  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('inquiries')
    .update({
      admin_reply: replyText,
      status: 'ANSWERED',
      answered_at: new Date().toISOString(),
    })
    .eq('id', inquiryId as string)
    .select(INQUIRY_COLUMNS)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'replyToInquiry: not found' };
  return { data: mapInquiry(data as InquiryRow), error: null };
}
