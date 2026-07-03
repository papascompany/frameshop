'use client';

import { Card } from '@/components/ui/Card';
import type { PointsLedgerEntry, PointsTransactionType } from '@/types/points';

type Props = {
  available: boolean;
  balance: number;
  ledger: PointsLedgerEntry[];
};

const TYPE_LABELS: Record<PointsTransactionType, string> = {
  ACCRUAL: '적립',
  REDEMPTION: '사용',
  ADJUSTMENT: '조정',
  REFUND: '환불 복원',
};

// KST 고정 포맷 — 서버(UTC)/클라(KST) 하이드레이션 불일치 방지.
const dateFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 적립금 마이페이지 (FS-EC-01) — 잔액 요약 + 최근 원장.
 * available=false(031 미적용)면 안내만 표시하고 원장은 렌더하지 않는다.
 */
export function PointsClient({ available, balance, ledger }: Props) {
  if (!available) {
    return (
      <Card padding="md">
        <p className="text-sm text-muted-fg">
          적립금 기능이 아직 활성화되지 않았습니다. 잠시 후 다시 확인해 주세요.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 잔액 요약 */}
      <Card padding="md">
        <p className="text-sm text-muted-fg mb-1">보유 적립금</p>
        <p className="text-2xl font-bold tabular-nums" data-testid="points-balance">
          {balance.toLocaleString('ko-KR')}P
        </p>
        <p className="text-xs text-muted-fg mt-2">
          1P = 1원으로 결제 시 사용할 수 있으며, 결제 완료 시 결제 금액의 1%가
          적립됩니다.
        </p>
      </Card>

      {/* 최근 내역 */}
      <Card padding="md">
        <h2 className="font-semibold mb-3">최근 내역</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-muted-fg">적립·사용 내역이 없습니다.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="points-ledger">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">
                      {TYPE_LABELS[entry.transactionType]}
                    </span>
                    {entry.description ? (
                      <span className="text-muted-fg"> · {entry.description}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-fg">
                    {dateFmt.format(new Date(entry.createdAt))}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={`text-sm tabular-nums font-medium ${
                      entry.pointsDelta >= 0 ? 'text-ink' : 'text-sale'
                    }`}
                  >
                    {entry.pointsDelta >= 0 ? '+' : ''}
                    {entry.pointsDelta.toLocaleString('ko-KR')}P
                  </p>
                  <p className="text-xs text-muted-fg tabular-nums">
                    잔액 {entry.balanceAfter.toLocaleString('ko-KR')}P
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
