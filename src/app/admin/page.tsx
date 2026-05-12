import Link from 'next/link';
import { Card } from '@/components/ui/Card';

const TILES: Array<{ href: string; title: string; description: string }> = [
  { href: '/admin/products', title: '상품', description: '상품 CRUD, 활성 토글' },
  { href: '/admin/frames', title: '프레임', description: '컬러별 PNG + inner_rect' },
  { href: '/admin/options', title: '옵션', description: '사이즈/색상/매트/인화지 매트릭스, CSV 일괄 등록' },
  { href: '/admin/orders', title: '주문', description: '주문 조회 및 상태 전이' },
  { href: '/admin/curation', title: '큐레이션', description: '랜딩 배너/컬렉션/feature' },
  { href: '/admin/shipping', title: '배송 설정', description: 'STANDARD/PICKUP/QUICK 요금' },
];

export default function AdminHomePage() {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">관리자 대시보드</h1>
        <p className="text-sm text-muted-fg">
          상품, 주문, 큐레이션, 배송 설정을 관리할 수 있습니다.
        </p>
      </header>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className="block">
            <Card padding="md" className="hover:bg-surface-muted transition-colors">
              <h2 className="text-base font-semibold">{t.title}</h2>
              <p className="text-xs text-muted-fg mt-1">{t.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
