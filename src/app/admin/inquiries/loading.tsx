export default function PageLoading() {
  return (
    <div className="animate-pulse space-y-4 p-6 md:p-8">
      <div className="h-6 w-36 bg-hairline rounded" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-20 bg-hairline rounded" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 border border-hairline rounded flex items-center px-4 gap-4">
            <div className="h-4 w-48 bg-hairline rounded" />
            <div className="ml-auto h-5 w-16 bg-hairline rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
