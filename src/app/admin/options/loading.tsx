export default function PageLoading() {
  return (
    <div className="animate-pulse space-y-4 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div className="h-6 w-36 bg-hairline rounded" />
        <div className="h-10 w-24 bg-hairline rounded-[30px]" />
      </div>
      <div className="border border-hairline rounded overflow-hidden">
        <div className="h-10 bg-soft-cloud border-b border-hairline" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 border-b border-hairline flex items-center px-4 gap-4">
            <div className="h-4 w-48 bg-hairline rounded" />
            <div className="ml-auto h-4 w-20 bg-hairline rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
