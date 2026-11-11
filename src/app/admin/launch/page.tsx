import Link from 'next/link';
import { requireAdmin } from '@/lib/db/admin';
import { collectLaunchSnapshot } from '@/lib/launch/collect';
import {
  evaluateLaunchReadiness,
  type ReadinessGroup,
  type ReadinessItem,
  type ReadinessStatus,
} from '@/lib/launch/readiness';

// 런칭 준비 점검 — 읽기 전용. 운영자 입력이 남은 런칭 게이트(BACKLOG §0)를 한 화면에.
export const metadata = { title: '런칭 준비 점검 · FrameShop Admin' };

// env·DB 현재 상태를 매 요청 다시 읽는다(정적 캐시 금지).
export const dynamic = 'force-dynamic';

const STATUS_META: Record<ReadinessStatus, { label: string; textClass: string }> = {
  blocker: { label: '차단', textClass: 'text-sale' },
  warn: { label: '주의', textClass: 'text-warning' },
  manual: { label: '수동 확인', textClass: 'text-info' },
  ok: { label: '정상', textClass: 'text-success' },
};

const SUMMARY_ORDER: ReadinessStatus[] = ['blocker', 'warn', 'manual', 'ok'];

const GROUPS: ReadonlyArray<{ id: ReadinessGroup; title: string }> = [
  { id: 'payment', title: '결제 (Toss)' },
  { id: 'site', title: '사이트·크론' },
  { id: 'shipping', title: '배송' },
  { id: 'notify', title: '알림' },
  { id: 'legal', title: '사업자·법적 고지' },
  { id: 'monitoring', title: '모니터링' },
  { id: 'migrations', title: 'DB 마이그레이션' },
  { id: 'hosting', title: '호스팅' },
];

function ItemRow({ item }: { item: ReadinessItem }) {
  const meta = STATUS_META[item.status];
  return (
    <li className="border border-hairline bg-canvas p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{item.title}</p>
        <span className={`shrink-0 text-xs font-semibold ${meta.textClass}`}>{meta.label}</span>
      </div>
      <p className="text-sm text-mute">{item.message}</p>
      {item.details && item.details.length > 0 ? (
        <ul className="text-xs text-mute space-y-0.5 list-disc pl-4">
          {item.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      {item.fix ? (
        <p className="text-xs">
          <span className="text-stone">고칠 곳: </span>
          {item.fix.href ? (
            <Link href={item.fix.href} className="text-ink underline underline-offset-2">
              {item.fix.label}
            </Link>
          ) : (
            <span className="text-ink">{item.fix.label}</span>
          )}
        </p>
      ) : null}
    </li>
  );
}

export default async function AdminLaunchPage() {
  await requireAdmin();

  const snapshot = await collectLaunchSnapshot();
  const { items, summary } = evaluateLaunchReadiness(snapshot);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">런칭 준비 점검</h1>
        <p className="text-sm text-muted-fg mt-1">
          실판매 전에 비어 있는 설정을 확인합니다. 읽기 전용이며, 비밀값은 표시하지 않고 설정 여부만 보여줍니다.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {SUMMARY_ORDER.map((status) => (
          <div key={status} className="border border-hairline bg-canvas p-4">
            <p className={`text-xs font-semibold ${STATUS_META[status].textClass}`}>
              {STATUS_META[status].label}
            </p>
            <p className="mt-1 text-2xl font-bold text-ink tabular-nums">{summary[status]}</p>
          </div>
        ))}
      </div>

      {GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group.id);
        if (groupItems.length === 0) return null;
        return (
          <section key={group.id} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-stone">
              {group.title}
            </h2>
            <ul className="space-y-2">
              {groupItems.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
