import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import StatusBadge from "./ui/StatusBadge";

const SIGNALS = [
  { key: "schema", label: "Structure", hint: "Column names, types, row count" },
  { key: "metadata", label: "Filename", hint: "Title / filename overlap" },
  { key: "temporal", label: "Time period", hint: "Date range overlap" },
  { key: "spatial", label: "Geography", hint: "Spatial extent overlap" },
  { key: "semantic", label: "Content", hint: "Title & description similarity" },
];

function explain(breakdown, totalScore, relationshipType) {
  if (!breakdown) return null;
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const [topKey, topVal] = entries[0];
  const topLabel = SIGNALS.find((s) => s.key === topKey)?.label || topKey;

  if (relationshipType === "exact_duplicate") {
    return "This is a byte-for-byte identical file already in the registry — every signal matches.";
  }
  if (totalScore >= 85) {
    return `High confidence: ${topLabel.toLowerCase()} and related signals strongly align (${topVal.toFixed(0)}%), consistent with the same underlying dataset.`;
  }
  if (totalScore >= 60) {
    return `Moderate confidence: ${topLabel.toLowerCase()} shows the strongest overlap (${topVal.toFixed(0)}%), but other signals differ enough that this may be a related — not identical — dataset.`;
  }
  return "Low confidence: signals only partially align. Likely a distinct dataset with superficial similarity.";
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="bg-ink-950 text-surface-50 text-xs px-2.5 py-1.5 rounded-sm tag-mono">
      {p.payload.label}: {p.value.toFixed(1)}%
    </div>
  );
}

export default function SimilarityBreakdown({ breakdown, totalScore, relationshipType, compact = false }) {
  const badgeVariant =
    relationshipType === "exact_duplicate"
      ? "danger"
      : ["new_version", "subset", "superset"].includes(relationshipType)
      ? "warning"
      : "info";

  const radarData = SIGNALS.map((s) => ({
    label: s.label,
    value: breakdown?.[s.key] ?? 0,
  }));

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-600 font-medium">
            Match confidence
          </div>
          <div className="tag-mono text-3xl font-semibold text-ink-950 mt-0.5">
            {totalScore?.toFixed(1)}%
          </div>
        </div>
        {relationshipType && (
          <StatusBadge variant={badgeVariant}>
            {relationshipType.replace(/_/g, " ").toUpperCase()}
          </StatusBadge>
        )}
      </div>

      {breakdown && (
        <p className="text-sm text-ink-700 leading-relaxed mb-4 bg-surface-50 border border-ink-200 rounded-sm px-3 py-2.5">
          {explain(breakdown, totalScore, relationshipType)}
        </p>
      )}

      {breakdown && (
        <div className={compact ? "h-[180px]" : "h-[220px]"}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius="75%">
              <PolarGrid stroke="#DDE3EC" />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "#475569" }} />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fontSize: 9, fill: "#94A3B8" }}
                tickCount={3}
              />
              <Radar
                dataKey="value"
                stroke="#14B8A6"
                fill="#14B8A6"
                fillOpacity={0.25}
                strokeWidth={2}
              />
              <Tooltip content={<CustomTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!compact && (
        <table className="w-full text-sm mt-2">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-600">
              <th className="text-left font-medium pb-1.5">Signal</th>
              <th className="text-left font-medium pb-1.5 hidden sm:table-cell">What it checks</th>
              <th className="text-right font-medium pb-1.5">Result</th>
            </tr>
          </thead>
          <tbody>
            {SIGNALS.map((s) => {
              const value = breakdown?.[s.key] ?? 0;
              return (
                <tr key={s.key} className="border-t border-ink-100">
                  <td className="py-2 text-ink-900">{s.label}</td>
                  <td className="py-2 text-ink-500 text-xs hidden sm:table-cell">{s.hint}</td>
                  <td className="py-2 text-right tag-mono text-ink-900">{value.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
