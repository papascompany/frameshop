/**
 * 관리자 알림 — 신규 주문 이메일 + Slack 웹훅.
 *
 * 실패해도 주문 플로우에 영향 없도록 모든 오류를 catch.
 * 설정(admin_email / slack_webhook_url)이 없으면 no-op.
 */

import 'server-only';
import { getSettings } from '@/lib/db/settings';
import type { OrderWithItems } from '@/types/order';

// ─── 공통 메시지 포맷 ────────────────────────────────────────────────────────

function buildOrderSummary(order: OrderWithItems): string {
  const itemLines = order.items
    .map(
      (item) =>
        `  - ${item.snapshot.productName} (${item.snapshot.sizeLabel} / ${item.snapshot.colorLabel}) x${item.quantity} — ${item.snapshot.unitPrice.toLocaleString('ko-KR')}원`,
    )
    .join('\n');

  return [
    `주문번호: ${order.orderNo}`,
    `주문인: ${order.orderer.name} (${order.orderer.phone})`,
    `총 금액: ${order.totalPrice.toLocaleString('ko-KR')}원`,
    `배송지: ${order.shipping.addr1} ${order.shipping.addr2}`.trim(),
    '',
    '주문 상품:',
    itemLines,
  ].join('\n');
}

// ─── Resend 이메일 발송 ──────────────────────────────────────────────────────

async function sendOrderEmail(
  adminEmail: string,
  resendApiKey: string,
  order: OrderWithItems,
): Promise<void> {
  const body = {
    from: 'FrameShop <noreply@frameshop.kr>',
    to: [adminEmail],
    subject: `[FrameShop] 새 주문 #${order.orderNo} — ${order.orderer.name}`,
    text: [
      '새 주문이 접수되었습니다.',
      '',
      buildOrderSummary(order),
    ].join('\n'),
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('[notify] Resend 이메일 발송 실패:', res.status, text);
  }
}

// ─── Slack 웹훅 ──────────────────────────────────────────────────────────────

async function sendSlackNotification(
  webhookUrl: string,
  order: OrderWithItems,
): Promise<void> {
  const text = `새 주문: #${order.orderNo} — ${order.orderer.name} — ${order.totalPrice.toLocaleString('ko-KR')}원`;

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn('[notify] Slack 웹훅 발송 실패:', res.status, t);
  }
}

// ─── 배송 시작 이메일 (고객 수신) ────────────────────────────────────────────

async function sendShippedEmail(
  customerEmail: string,
  resendApiKey: string,
  order: OrderWithItems,
  courier: string,
  trackingNumber: string,
): Promise<void> {
  const text = [
    `안녕하세요, ${order.orderer.name}님!`,
    '주문하신 상품이 발송되었습니다.',
    '',
    `주문번호: ${order.orderNo}`,
    `택배사: ${courier}`,
    `운송장번호: ${trackingNumber}`,
    '',
    '배송 예정일은 영업일 기준 1~3일입니다.',
    '감사합니다.',
    'FrameShop 드림',
  ].join('\n');

  const body = {
    from: 'FrameShop <noreply@frameshop.kr>',
    to: [customerEmail],
    subject: `[FrameShop] 주문 #${order.orderNo} 배송이 시작되었습니다`,
    text,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn('[notify] 배송 알림 이메일 발송 실패:', res.status, t);
  }
}

// ─── 배송 완료 이메일 (고객 수신) ────────────────────────────────────────────

async function sendDeliveredEmail(
  customerEmail: string,
  resendApiKey: string,
  order: OrderWithItems,
): Promise<void> {
  const text = [
    `안녕하세요, ${order.orderer.name}님!`,
    '주문하신 상품의 배송이 완료되었습니다.',
    '',
    `주문번호: ${order.orderNo}`,
    '',
    '상품을 잘 받으셨길 바랍니다.',
    '이용해 주셔서 감사합니다.',
    'FrameShop 드림',
  ].join('\n');

  const body = {
    from: 'FrameShop <noreply@frameshop.kr>',
    to: [customerEmail],
    subject: `[FrameShop] 주문 #${order.orderNo} 배송이 완료되었습니다`,
    text,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn('[notify] 배송 완료 알림 이메일 발송 실패:', res.status, t);
  }
}

// ─── 주문 취소 이메일 (고객 수신) ────────────────────────────────────────────

async function sendCancelledEmail(
  customerEmail: string,
  resendApiKey: string,
  order: OrderWithItems,
  reason?: string,
): Promise<void> {
  const text = [
    `안녕하세요, ${order.orderer.name}님.`,
    '주문이 취소되었습니다.',
    '',
    `주문번호: ${order.orderNo}`,
    ...(reason ? [`취소 사유: ${reason}`] : []),
    '',
    '결제가 완료된 주문이라면 영업일 기준 3~5일 내 환불 처리됩니다.',
    '문의사항이 있으시면 고객센터로 연락 주시기 바랍니다.',
    'FrameShop 드림',
  ].join('\n');

  const body = {
    from: 'FrameShop <noreply@frameshop.kr>',
    to: [customerEmail],
    subject: `[FrameShop] 주문 #${order.orderNo} 이 취소되었습니다`,
    text,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn('[notify] 주문 취소 알림 이메일 발송 실패:', res.status, t);
  }
}

// ─── 환불 완료 이메일 (고객 수신) ────────────────────────────────────────────

async function sendRefundedEmail(
  customerEmail: string,
  resendApiKey: string,
  order: OrderWithItems,
  reason?: string,
): Promise<void> {
  const text = [
    `안녕하세요, ${order.orderer.name}님.`,
    '환불이 완료되었습니다.',
    '',
    `주문번호: ${order.orderNo}`,
    `환불 금액: ${order.totalPrice.toLocaleString('ko-KR')}원`,
    ...(reason ? [`환불 사유: ${reason}`] : []),
    '',
    '환불 금액은 결제 수단에 따라 영업일 기준 3~5일 내 반영됩니다.',
    '이용해 주셔서 감사합니다.',
    'FrameShop 드림',
  ].join('\n');

  const body = {
    from: 'FrameShop <noreply@frameshop.kr>',
    to: [customerEmail],
    subject: `[FrameShop] 주문 #${order.orderNo} 환불이 완료되었습니다`,
    text,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.warn('[notify] 환불 완료 알림 이메일 발송 실패:', res.status, t);
  }
}

// ─── 공개 API ────────────────────────────────────────────────────────────────

/**
 * 배송 시작 고객 알림.
 * email이 없거나 Resend API 키가 없으면 no-op.
 * 실패해도 상위 호출에 영향 없음.
 */
export async function notifyShipped(
  order: OrderWithItems,
  courier: string,
  trackingNumber: string,
): Promise<void> {
  const customerEmail = order.orderer?.email;
  if (!customerEmail) return;

  const settings = await getSettings(['resend_api_key']).catch(
    (): Record<string, string> => ({}),
  );

  const resendApiKey =
    process.env.RESEND_API_KEY ?? settings['resend_api_key'];

  if (!resendApiKey) return;

  await sendShippedEmail(
    customerEmail,
    resendApiKey,
    order,
    courier,
    trackingNumber,
  ).catch((e: unknown) => {
    console.warn('[notify] 배송 알림 예외:', e);
  });
}

/**
 * 신규 주문 관리자 알림.
 * 이메일 + Slack 모두 실패해도 상위 호출에 영향 없음.
 */
export async function notifyNewOrder(order: OrderWithItems): Promise<void> {
  const settings = await getSettings([
    'admin_email',
    'resend_api_key',
    'slack_webhook_url',
  ]).catch((): Record<string, string> => ({}));

  const adminEmail = settings['admin_email'];
  const resendApiKey =
    process.env.RESEND_API_KEY ?? settings['resend_api_key'];
  const slackWebhookUrl = settings['slack_webhook_url'];

  const tasks: Promise<void>[] = [];

  if (adminEmail && resendApiKey) {
    tasks.push(
      sendOrderEmail(adminEmail, resendApiKey, order).catch((e: unknown) => {
        console.warn('[notify] 이메일 알림 예외:', e);
      }),
    );
  }

  if (slackWebhookUrl) {
    tasks.push(
      sendSlackNotification(slackWebhookUrl, order).catch((e: unknown) => {
        console.warn('[notify] Slack 알림 예외:', e);
      }),
    );
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }
}

/**
 * 배송 완료 고객 알림.
 * email이 없거나 Resend API 키가 없으면 no-op.
 * 실패해도 상위 호출에 영향 없음.
 */
export async function notifyDelivered(order: OrderWithItems): Promise<void> {
  const customerEmail = order.orderer?.email;
  if (!customerEmail) return;

  const settings = await getSettings(['resend_api_key']).catch(
    (): Record<string, string> => ({}),
  );

  const resendApiKey =
    process.env.RESEND_API_KEY ?? settings['resend_api_key'];

  if (!resendApiKey) return;

  await sendDeliveredEmail(customerEmail, resendApiKey, order).catch(
    (e: unknown) => {
      console.warn('[notify] 배송 완료 알림 예외:', e);
    },
  );
}

/**
 * 주문 취소 고객 알림.
 * email이 없거나 Resend API 키가 없으면 no-op.
 * 실패해도 상위 호출에 영향 없음.
 */
export async function notifyCancelled(
  order: OrderWithItems,
  reason?: string,
): Promise<void> {
  const customerEmail = order.orderer?.email;
  if (!customerEmail) return;

  const settings = await getSettings(['resend_api_key']).catch(
    (): Record<string, string> => ({}),
  );

  const resendApiKey =
    process.env.RESEND_API_KEY ?? settings['resend_api_key'];

  if (!resendApiKey) return;

  await sendCancelledEmail(customerEmail, resendApiKey, order, reason).catch(
    (e: unknown) => {
      console.warn('[notify] 주문 취소 알림 예외:', e);
    },
  );
}

/**
 * 환불 완료 고객 알림.
 * email이 없거나 Resend API 키가 없으면 no-op.
 * 실패해도 상위 호출에 영향 없음.
 */
export async function notifyRefunded(
  order: OrderWithItems,
  reason?: string,
): Promise<void> {
  const customerEmail = order.orderer?.email;
  if (!customerEmail) return;

  const settings = await getSettings(['resend_api_key']).catch(
    (): Record<string, string> => ({}),
  );

  const resendApiKey =
    process.env.RESEND_API_KEY ?? settings['resend_api_key'];

  if (!resendApiKey) return;

  await sendRefundedEmail(customerEmail, resendApiKey, order, reason).catch(
    (e: unknown) => {
      console.warn('[notify] 환불 완료 알림 예외:', e);
    },
  );
}
