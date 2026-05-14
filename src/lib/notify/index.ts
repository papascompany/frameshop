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

// ─── 공개 API ────────────────────────────────────────────────────────────────

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
