import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import DataTable from "../components/ui/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import { SkeletonTable, SkeletonCard } from "../components/ui/Skeleton";

const SEVERITY_VARIANT = { critical: "danger", high: "danger", medium: "warning", low: "info" };
const STATUS_VARIANT = {
  new: "warning",
  investigating: "info",
  acknowledged: "info",
  resolved: "success",
  false_positive: "neutral",
};

const columns = [
  { key: "title", label: "Dataset", sortable: true },
  {
    key: "severity",
    label: "Severity",
    sortable: true,
    render: (r) => <StatusBadge variant={SEVERITY_VARIANT[r.severity]}>{r.severity}</StatusBadge>,
  },
  {
    key: "similarity_score",
    label: "Match",
    sortable: true,
    render: (r) => <span className="tag-mono">{parseFloat(r.similarity_score).toFixed(1)}%</span>,
  },
  {
    key: "status",
    label: "Status",
    sortable: true,
    render: (r) => <StatusBadge variant={STATUS_VARIANT[r.status]}>{r.status.replace(/_/g, " ")}</StatusBadge>,
  },
  { key: "owner_department", label: "Department", sortable: true },
  {
    key: "detected_at",
    label: "Detected",
    sortable: true,
    render: (r) => new Date(r.detected_at).toLocaleDateString("en-IN"),
  },
];

export default function AlertCenter() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState(null);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try {
      const params = {};
      if (status) params.status = status;
      if (severity) params.severity = severity;
      const [alertsRes, summaryRes] = await Promise.all([
        api.get("/alerts", { params }),
        api.get("/alerts/summary"),
      ]);
      setAlerts(alertsRes.data.alerts);
      setSummary(summaryRes.data);
    } catch (err) {
      setError(err.response?.data?.error || "We couldn't load alerts. The service may be temporarily unavailable.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, severity]);

  return (
    <div>
      <h1 className="font-display font-semibold text-2xl text-ink-950">Alert Center</h1>
      <p className="text-sm text-ink-600 mt-1 mb-6">
        Every detected duplicate or high-similarity match, with a real review workflow.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {!summary ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <SummaryTile label="Total alerts" value={summary.total} />
            <SummaryTile label="New" value={summary.byStatus.new} accent="alert" />
            <SummaryTile label="Critical" value={summary.bySeverity.critical} accent="deny" />
            <SummaryTile label="Resolved" value={summary.byStatus.resolved} accent="verify" />
          </>
        )}
      </div>

      <div className="flex gap-3 mb-4">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-44">
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="investigating">Investigating</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
          <option value="false_positive">False positive</option>
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="input w-44">
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {!alerts && !error && <SkeletonTable rows={5} columns={6} />}
      {error && <ErrorState description={error} onRetry={load} />}
      {alerts && alerts.length === 0 && (
        <EmptyState
          title="No alerts match these filters"
          description="Try clearing the status or severity filter, or check back after more uploads run through the registry."
        />
      )}
      {alerts && alerts.length > 0 && (
        <DataTable
          columns={columns}
          rows={alerts}
          rowKey="relationship_id"
          onRowClick={(r) => navigate(`/alerts/${r.relationship_id}`)}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value, accent }) {
  const colors = { alert: "text-alert-600", deny: "text-deny-600", verify: "text-verify-600" };
  return (
    <div className="bg-white border border-ink-200 rounded-sm p-4">
      <div className="text-[11px] text-ink-600 uppercase tracking-wide font-medium">{label}</div>
      <div className={`font-display font-semibold text-2xl mt-1 ${accent ? colors[accent] : "text-ink-950"}`}>
        {value ?? 0}
      </div>
    </div>
  );
}
