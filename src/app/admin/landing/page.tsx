/**
 * /admin/landing — 랜딩 페이지 섹션 콘텐츠 관리
 *
 * Server Component: DB에서 현재 저장된 섹션 데이터를 읽어
 * LandingEditor 클라이언트 컴포넌트에 전달.
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/db/admin';
import { getAllLandingSectionsAdmin } from '@/lib/db/landing-sections';
import type { LandingSection } from '@/lib/db/landing-sections';
import { LandingEditor } from './LandingEditor';

export const dynamic = 'force-dynamic';

export default async function AdminLandingPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }

  let sections: LandingSection[] = [];
  try {
    sections = await getAllLandingSectionsAdmin();
  } catch {
    // DB 미설정 환경에서도 에디터 렌더링 허용
  }

  // sectionKey → LandingSection 맵
  const sectionMap: Record<string, LandingSection> = {};
  for (const s of sections) {
    sectionMap[s.sectionKey] = s;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">랜딩 관리</h1>
        <p className="text-sm text-muted-fg">
          랜딩 페이지의 각 섹션 이미지와 텍스트를 편집합니다. 저장하지 않은 항목은
          정적 기본값이 사용됩니다.
        </p>
      </header>

      <LandingEditor sectionMap={sectionMap} />
    </div>
  );
}
