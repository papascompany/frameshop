import { listShippingMethods } from '@/lib/db/shipping';
import { ShippingClient } from './ShippingClient';

export const dynamic = 'force-dynamic';

export default async function AdminShippingPage() {
  let methods: Awaited<ReturnType<typeof listShippingMethods>> = [];
  try {
    methods = await listShippingMethods();
  } catch {
    // env not configured yet — renders empty table
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">배송 설정 (ADR-008)</h1>
      {methods.length === 0 ? (
        <p className="text-sm text-muted-fg py-6 text-center">
          배송 방법이 없습니다. Supabase 연결 및 초기 데이터를 확인하세요.
        </p>
      ) : (
        <ShippingClient methods={methods} />
      )}
    </div>
  );
}
