export default function CartLoading() {
  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-8 animate-pulse">
      <div className="h-7 w-24 bg-soft-cloud rounded mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-4 p-4 border border-hairline">
              <div className="w-24 h-24 bg-soft-cloud shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 bg-soft-cloud rounded" />
                <div className="h-3 w-1/2 bg-soft-cloud rounded" />
                <div className="h-4 w-1/4 bg-soft-cloud rounded" />
              </div>
            </div>
          ))}
        </div>
        <div className="h-48 bg-soft-cloud rounded" />
      </div>
    </div>
  );
}
