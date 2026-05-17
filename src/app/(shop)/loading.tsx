/**
 * Shop root loading skeleton.
 * Shown immediately when navigating to the landing page — header/footer
 * stay visible (they live in layout.tsx), only the content area pulses.
 */
export default function ShopLoading() {
  return (
    <div className="animate-pulse">
      {/* Hero skeleton */}
      <div className="w-full aspect-[16/7] bg-soft-cloud" />

      {/* Featured Frames skeleton */}
      <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-12">
        <div className="h-4 w-24 bg-soft-cloud rounded mb-2" />
        <div className="h-7 w-48 bg-soft-cloud rounded mb-8" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3">
              <div className="aspect-square bg-soft-cloud" />
              <div className="h-4 w-3/4 bg-soft-cloud rounded" />
              <div className="h-3 w-1/2 bg-soft-cloud rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
