export default function ProductWorkspaceLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-6 w-48 bg-hairline rounded" />
      {/* Tab bar */}
      <div className="flex gap-2 border-b border-hairline pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-20 bg-hairline rounded" />
        ))}
      </div>
      {/* Panel */}
      <div className="border border-hairline rounded p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-soft-cloud rounded" />
        ))}
      </div>
    </div>
  );
}
