/**
 * Admin root loading skeleton.
 * Sidebar stays rendered (lives in layout), only the content area pulses.
 */
export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-4 p-6 md:p-8">
      {/* Page title */}
      <div className="h-6 w-40 bg-hairline rounded" />
      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 bg-hairline rounded-[4px]" />
        ))}
      </div>
    </div>
  );
}
