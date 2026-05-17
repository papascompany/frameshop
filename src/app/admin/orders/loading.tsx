export default function OrdersLoading() {
  return (
    <div className="animate-pulse space-y-4 p-6 md:p-8">
      <div className="h-6 w-32 bg-hairline rounded" />
      {/* Tabs skeleton */}
      <div className="flex gap-2 border-b border-hairline pb-0">
        {[60, 48, 48, 48, 56].map((w, i) => (
          <div key={i} className={`h-9 w-${w} bg-hairline rounded-t`} style={{ width: w * 2 }} />
        ))}
      </div>
      {/* Table rows */}
      <div className="border border-hairline rounded overflow-hidden">
        <div className="h-10 bg-soft-cloud border-b border-hairline" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 border-b border-hairline flex items-center px-4 gap-6">
            <div className="h-3 w-28 bg-hairline rounded font-mono" />
            <div className="h-5 w-16 bg-hairline rounded-full" />
            <div className="h-4 w-20 bg-hairline rounded" />
            <div className="ml-auto h-4 w-20 bg-hairline rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
