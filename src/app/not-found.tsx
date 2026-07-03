import Link from 'next/link';
import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/Button';

/**
 * Root 404 — notFound() 호출 및 미매칭 URL 전체를 처리한다. FS-EC-05.
 *
 * Root layout 아래에서 렌더되므로 (shop) Header/Footer는 없다.
 * 디자인 시스템(Container·Button·heading 유틸)을 재사용하고
 * 홈·카탈로그 복귀 경로를 제공한다.
 */
export default function NotFound() {
  return (
    <Container size="sm" className="flex-1 grid place-items-center py-20">
      <div className="text-center space-y-4">
        <p className="display-campaign text-ink" aria-hidden>
          404
        </p>
        <h1 className="heading-lg">페이지를 찾을 수 없습니다</h1>
        <p className="text-sm text-mute leading-relaxed">
          주소가 잘못되었거나 삭제된 페이지입니다.
          <br />
          아래 버튼으로 다시 시작해 보세요.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link href="/">
            <Button variant="primary" size="md">
              홈으로 가기
            </Button>
          </Link>
          <Link href="/catalog/basic-frame">
            <Button variant="secondary" size="md">
              액자 카탈로그 보기
            </Button>
          </Link>
        </div>
      </div>
    </Container>
  );
}
