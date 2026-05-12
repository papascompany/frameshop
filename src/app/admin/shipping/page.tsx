import { listShippingMethods } from '@/lib/db/shipping';

export default async function AdminShippingPage() {
  let methods: Awaited<ReturnType<typeof listShippingMethods>> = [];
  try {
    methods = await listShippingMethods();
  } catch {
    // env not configured yet
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">배송 설정 (ADR-008)</h1>
      <table className="w-full text-sm">
        <thead className="text-left border-b border-border">
          <tr>
            <th className="py-2">코드</th>
            <th className="py-2">라벨</th>
            <th className="py-2">요금</th>
            <th className="py-2">무료 임계값</th>
            <th className="py-2">활성</th>
          </tr>
        </thead>
        <tbody>
          {methods.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-muted-fg">
                Phase 1 stub — Supabase 연결 후 표시됩니다.
              </td>
            </tr>
          ) : (
            methods.map((m) => (
              <tr key={m.id} className="border-b border-border">
                <td className="py-2 font-mono">{m.code}</td>
                <td className="py-2">{m.label}</td>
                <td className="py-2 tabular-nums">
                  {m.fee.toLocaleString('ko-KR')}원
                </td>
                <td className="py-2 tabular-nums">
                  {m.freeThreshold === null
                    ? '—'
                    : `${m.freeThreshold.toLocaleString('ko-KR')}원`}
                </td>
                <td className="py-2">{m.isActive ? '✓' : '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <p className="text-xs text-muted-fg">
        편집 UI는 Phase 2 — Phase 1은 `bulkUpdateShippingMethods` 서버 액션을
        통해 갱신합니다.
      </p>
    </div>
  );
}
