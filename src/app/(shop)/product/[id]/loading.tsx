/**
 * Product detail page loading skeleton.
 */
export default function ProductLoading() {
  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-8 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
        {/* Image skeleton */}
        <div className="aspect-square bg-soft-cloud w-full" />

        {/* Detail panel skeleton */}
        <div className="space-y-4 pt-2">
          <div className="h-3 w-24 bg-soft-cloud rounded" />
          <div className="h-8 w-3/4 bg-soft-cloud rounded" />
          <div className="h-5 w-1/3 bg-soft-cloud rounded" />
          <div className="h-px bg-soft-cloud my-6" />
          <div className="space-y-2">
            <div className="h-4 w-full bg-soft-cloud rounded" />
            <div className="h-4 w-5/6 bg-soft-cloud rounded" />
            <div className="h-4 w-4/6 bg-soft-cloud rounded" />
          </div>
          <div className="h-px bg-soft-cloud my-6" />
          {/* Option selectors */}
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 bg-soft-cloud rounded-[24px]" />
            ))}
          </div>
          <div className="h-14 bg-soft-cloud rounded-[30px] mt-4" />
        </div>
      </div>
    </div>
  );
}
