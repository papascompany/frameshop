/**
 * Catalog page loading skeleton.
 * User sees this immediately when clicking a catalog link — product grid
 * pulses while the RSC payload is fetched.
 */
export default function CatalogLoading() {
  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-8 md:py-12 animate-pulse">
      {/* Section header skeleton */}
      <div className="mb-8">
        <div className="h-3 w-20 bg-soft-cloud rounded mb-2" />
        <div className="h-8 w-48 bg-soft-cloud rounded" />
      </div>

      {/* Product grid skeleton — 2 cols mobile, 3 desktop */}
      <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="space-y-3">
            <div className="aspect-square bg-soft-cloud" />
            <div className="h-4 w-3/4 bg-soft-cloud rounded" />
            <div className="h-3 w-1/2 bg-soft-cloud rounded" />
            <div className="h-4 w-1/3 bg-soft-cloud rounded" />
          </li>
        ))}
      </ul>
    </div>
  );
}
