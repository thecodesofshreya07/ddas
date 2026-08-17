import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

/**
 * columns: [{ key, label, sortable?, render?(row) }]
 * Renders a proper dense table on desktop. Below `md`, switches to stacked
 * record summaries instead of a horizontally-scrolling table — per the
 * "no unreadable horizontal-scroll tables on mobile" rule.
 */
export default function DataTable({ columns, rows, rowKey, pageSize = 10, onRowClick }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice(page * pageSize, page * pageSize + pageSize);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  return (
    <div>
      {/* Desktop table */}
      <div className="hidden md:block bg-white border border-ink-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-100 sticky top-0">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-ink-600 font-medium"
                >
                  {col.sortable ? (
                    <button
                      onClick={() => toggleSort(col.key)}
                      className="flex items-center gap-1 hover:text-ink-950"
                    >
                      {col.label}
                      {sortKey === col.key &&
                        (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr
                key={row[rowKey]}
                onClick={() => onRowClick?.(row)}
                className={`border-t border-ink-100 ${
                  onRowClick ? "cursor-pointer hover:bg-surface-50" : ""
                }`}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-ink-800">
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked record summaries, not a horizontally-scrolled table */}
      <div className="md:hidden space-y-2">
        {pageRows.map((row) => (
          <button
            key={row[rowKey]}
            onClick={() => onRowClick?.(row)}
            className="w-full text-left bg-white border border-ink-200 rounded-sm p-4"
          >
            {columns.map((col) => (
              <div key={col.key} className="flex items-baseline justify-between gap-3 py-0.5">
                <span className="text-[11px] text-ink-600 shrink-0">{col.label}</span>
                <span className="text-sm text-ink-900 text-right truncate">
                  {col.render ? col.render(row) : row[col.key]}
                </span>
              </div>
            ))}
          </button>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-ink-600">
          <span>
            Page {page + 1} of {totalPages} · {sorted.length} results
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-2.5 py-1 border border-ink-200 rounded-sm disabled:opacity-40 hover:bg-surface-50"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="px-2.5 py-1 border border-ink-200 rounded-sm disabled:opacity-40 hover:bg-surface-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
