export default function AdminLandingLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* 페이지 헤더 스켈레톤 */}
      <div className="space-y-2">
        <div className="h-7 w-40 bg-soft-cloud rounded" />
        <div className="h-4 w-80 bg-soft-cloud rounded" />
      </div>

      {/* 탭 바 스켈레톤 */}
      <div className="flex gap-2 border-b border-hairline pb-1">
        {[100, 80, 90, 75, 80].map((w, i) => (
          <div key={i} className={`h-8 w-${w >= 100 ? '28' : w >= 90 ? '24' : '20'} bg-soft-cloud rounded`} />
        ))}
      </div>

      {/* 섹션 카드 스켈레톤 */}
      {[0, 1, 2].map((i) => (
        <div key={i} className="border border-hairline rounded-lg p-4 space-y-4">
          <div className="h-4 w-32 bg-soft-cloud rounded" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="aspect-video bg-soft-cloud rounded" />
            <div className="space-y-3">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-8 bg-soft-cloud rounded" />
              ))}
            </div>
          </div>
          <div className="h-9 w-16 bg-soft-cloud rounded" />
        </div>
      ))}
    </div>
  );
}
