import { FilePlus2, FileMinus2, FileCheck2 } from "lucide-react";

/**
 * Renders whatever computeContentDiff() on the backend produced. Three
 * shapes: csv (row-level), text (line-level), incomparable (honest
 * fallback for PDFs/images/format-mismatches — never fabricated).
 */
export default function DiffView({ diff }) {
  if (!diff) return null;

  if (diff.type === "incomparable") {
    return (
      <div className="bg-surface-50 border border-ink-200 rounded-sm px-3 py-2.5 text-xs text-ink-600">
        {diff.reason}. The similarity score above is still based on structure and metadata —
        just not a line-by-line comparison.
      </div>
    );
  }

  if (diff.type === "csv") {
    if (diff.identical) {
      return (
        <div className="flex items-center gap-2 bg-verify-500/5 border border-verify-500/20 rounded-sm px-3 py-2.5 text-sm text-verify-700">
          <FileCheck2 size={15} />
          Content is identical — every row and column matches exactly.
        </div>
      );
    }
    return (
      <div>
        <div className="flex flex-wrap gap-4 text-xs mb-3">
          <Stat label="Unchanged rows" value={diff.unchangedRows} tone="neutral" />
          <Stat label="Rows added" value={diff.addedRowCount} tone="add" />
          <Stat label="Rows removed" value={diff.removedRowCount} tone="remove" />
          {(diff.columnsAdded.length > 0 || diff.columnsRemoved.length > 0) && (
            <Stat
              label="Columns changed"
              value={diff.columnsAdded.length + diff.columnsRemoved.length}
              tone="warn"
            />
          )}
        </div>

        {(diff.columnsAdded.length > 0 || diff.columnsRemoved.length > 0) && (
          <div className="mb-3 text-xs">
            {diff.columnsAdded.length > 0 && (
              <div className="text-verify-700">+ Columns added: {diff.columnsAdded.join(", ")}</div>
            )}
            {diff.columnsRemoved.length > 0 && (
              <div className="text-deny-600">− Columns removed: {diff.columnsRemoved.join(", ")}</div>
            )}
          </div>
        )}

        {diff.addedRowsPreview.length > 0 && (
          <RowPreview title="Added rows" icon={FilePlus2} tone="add" rows={diff.addedRowsPreview} />
        )}
        {diff.removedRowsPreview.length > 0 && (
          <RowPreview title="Removed rows" icon={FileMinus2} tone="remove" rows={diff.removedRowsPreview} />
        )}
        {diff.previewTruncated && (
          <div className="text-[11px] text-ink-500 mt-1">Preview truncated — showing the first rows only.</div>
        )}
      </div>
    );
  }

  if (diff.type === "text") {
    if (diff.identical) {
      return (
        <div className="flex items-center gap-2 bg-verify-500/5 border border-verify-500/20 rounded-sm px-3 py-2.5 text-sm text-verify-700">
          <FileCheck2 size={15} />
          Content is identical, line for line.
        </div>
      );
    }
    return (
      <div>
        <div className="flex flex-wrap gap-4 text-xs mb-3">
          <Stat label="Unchanged lines" value={diff.unchangedLines} tone="neutral" />
          <Stat label="Lines added" value={diff.addedLines} tone="add" />
          <Stat label="Lines removed" value={diff.removedLines} tone="remove" />
        </div>
        <pre className="bg-ink-950 text-surface-200 text-[11px] leading-relaxed rounded-sm p-3 overflow-x-auto tag-mono max-h-64 overflow-y-auto">
          {diff.preview.map((line, i) => (
            <div
              key={i}
              className={line.startsWith("+") ? "text-verify-400" : line.startsWith("-") ? "text-deny-400" : ""}
            >
              {line}
            </div>
          ))}
        </pre>
        {diff.previewTruncated && (
          <div className="text-[11px] text-ink-500 mt-1">Preview truncated — showing the first changed lines only.</div>
        )}
      </div>
    );
  }

  return null;
}

function Stat({ label, value, tone }) {
  const colors = {
    neutral: "text-ink-900",
    add: "text-verify-700",
    remove: "text-deny-600",
    warn: "text-alert-600",
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`tag-mono text-base font-semibold ${colors[tone]}`}>{value}</div>
    </div>
  );
}

function RowPreview({ title, icon: Icon, tone, rows }) {
  const toneClasses = tone === "add" ? "border-verify-500/30 bg-verify-500/5" : "border-deny-500/30 bg-deny-500/5";
  const textTone = tone === "add" ? "text-verify-700" : "text-deny-600";
  return (
    <div className={`border rounded-sm p-2.5 mb-2 ${toneClasses}`}>
      <div className={`flex items-center gap-1.5 text-xs font-medium mb-1.5 ${textTone}`}>
        <Icon size={13} />
        {title} ({rows.length}{rows.length >= 25 ? "+" : ""})
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {rows.slice(0, 10).map((row, i) => (
          <div key={i} className="tag-mono text-[11px] text-ink-700 truncate">
            {Object.entries(row)
              .slice(0, 4)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </div>
        ))}
      </div>
    </div>
  );
}
