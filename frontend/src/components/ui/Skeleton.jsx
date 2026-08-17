export function SkeletonLine({ width = "100%", height = 12 }) {
  return (
    <div
      className="bg-ink-100 rounded-sm animate-pulse"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function SkeletonRow({ columns = 4 }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-ink-100">
      {Array.from({ length: columns }).map((_, i) => (
        <SkeletonLine key={i} width={i === 0 ? "30%" : "15%"} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }) {
  return (
    <div className="bg-white border border-ink-200 rounded-sm overflow-hidden" role="status" aria-label="Loading data">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} columns={columns} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white border border-ink-200 rounded-sm p-5 space-y-3" role="status" aria-label="Loading">
      <SkeletonLine width="40%" height={10} />
      <SkeletonLine width="60%" height={24} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
