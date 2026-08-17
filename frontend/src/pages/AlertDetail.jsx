import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api/client";
import SimilarityBreakdown from "../components/SimilarityBreakdown";
import DiffView from "../components/DiffView";
import StatusBadge from "../components/ui/StatusBadge";
import ClassificationBadge from "../components/ui/ClassificationBadge";
import ErrorState from "../components/ui/ErrorState";
import { SkeletonLine, SkeletonTable } from "../components/ui/Skeleton";

const SEVERITY_VARIANT = { critical: "danger", high: "danger", medium: "warning", low: "info" };
const STATUS_VARIANT = {
  new: "warning",
  investigating: "info",
  acknowledged: "info",
  resolved: "success",
  false_positive: "neutral",
};

const STATUS_ACTIONS = [
  { status: "investigating", label: "Investigate" },
  { status: "acknowledged", label: "Acknowledge" },
  { status: "resolved", label: "Resolve" },
  { status: "false_positive", label: "Mark false positive" },
];

const EVENT_LABELS = {
  UPLOAD: "Dataset uploaded",
  DUPLICATE_DETECTED: "Duplicate/similar dataset detected",
  DOWNLOAD_ALERT_SHOWN: "Pre-download alert shown",
  DOWNLOAD_ALLOWED: "Download completed",
  DOWNLOAD_DENIED: "Download denied (access policy)",
  DATASET_REUSED: "Existing dataset reused",
  ALERT_STATUS_CHANGED: "Alert status changed",
  ACCESS_DENIED: "Access denied (restricted dataset)",
  EXTENSION_DUPLICATE_DETECTED: "Duplicate detected via browser extension",
};

export default function AlertDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await api.get(`/alerts/${id}`);
      setData(data);
      setNotes(data.review.notes || "");
    } catch (err) {
      setError(
        err.response?.status === 404
          ? "This alert doesn't exist."
          : "We couldn't load this alert. The service may be temporarily unavailable."
      );
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateStatus(status) {
    setUpdating(true);
    try {
      await api.post(`/alerts/${id}/status`, { status, notes });
      await load();
    } finally {
      setUpdating(false);
    }
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) {
    return (
      <div className="space-y-4">
        <SkeletonLine width="50%" height={28} />
        <SkeletonTable rows={4} columns={3} />
      </div>
    );
  }

  const { relationship, severity, review, previousOccurrences, auditTrail } = data;

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="tag-mono text-xs text-ink-500">
            ALERT #{relationship.id.slice(0, 8).toUpperCase()}
          </div>
          <h1 className="font-display font-semibold text-2xl text-ink-950 mt-1">
            {relationship.a_title}
          </h1>
        </div>
        <div className="flex gap-2">
          <StatusBadge variant={SEVERITY_VARIANT[severity]}>{severity} severity</StatusBadge>
          <StatusBadge variant={STATUS_VARIANT[review.status]}>{review.status.replace(/_/g, " ")}</StatusBadge>
        </div>
      </div>

      {/* What happened */}
      <Section title="What happened">
        <p className="text-sm text-ink-700 leading-relaxed">
          A {relationship.relationship_type.replace(/_/g, " ")} was detected between{" "}
          <Link to={`/datasets/${relationship.a_dataset_id}`} className="text-verify-700 hover:underline">
            {relationship.a_title}
          </Link>{" "}
          ({relationship.a_department}) and{" "}
          <Link to={`/datasets/${relationship.b_dataset_id}`} className="text-verify-700 hover:underline">
            {relationship.b_title}
          </Link>{" "}
          ({relationship.b_department}), uploaded {new Date(relationship.a_uploaded_at).toLocaleDateString("en-IN")}.
        </p>
        <div className="flex items-center gap-3 mt-3">
          <ClassificationBadge level={relationship.a_classification} />
          {previousOccurrences > 0 && (
            <span className="text-xs text-ink-600">
              {previousOccurrences} previous related detection{previousOccurrences === 1 ? "" : "s"} for this dataset
            </span>
          )}
        </div>
      </Section>

      {/* Why detected — evidence */}
      <Section title="Why it was detected">
        <SimilarityBreakdown
          breakdown={relationship.score_breakdown}
          totalScore={parseFloat(relationship.similarity_score)}
          relationshipType={relationship.relationship_type}
        />
      </Section>

      {relationship.content_diff && (
        <Section title="What actually changed">
          <DiffView diff={relationship.content_diff} />
        </Section>
      )}

      {/* Recommended action */}
      <Section title="Actions">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add investigation notes (optional, saved with your next status update)…"
          className="input min-h-[70px] mb-3"
        />
        <div className="flex flex-wrap gap-2">
          {STATUS_ACTIONS.map((a) => (
            <button
              key={a.status}
              onClick={() => updateStatus(a.status)}
              disabled={updating || review.status === a.status}
              className={`text-xs font-medium px-3 py-2 rounded-sm border transition-colors disabled:opacity-40 ${
                a.status === "false_positive"
                  ? "border-ink-200 text-ink-700 hover:bg-surface-50"
                  : "border-verify-500/40 text-verify-700 hover:bg-verify-500/10"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        {review.assignee_name && (
          <div className="text-xs text-ink-500 mt-3">Assigned to {review.assignee_name}</div>
        )}
      </Section>

      {/* Audit trail */}
      <Section title="Audit trail">
        {auditTrail.length === 0 ? (
          <p className="text-sm text-ink-500">No related audit events recorded.</p>
        ) : (
          <ol className="space-y-2.5">
            {auditTrail.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <span className="tag-mono text-[11px] text-ink-500 w-32 shrink-0">
                  {new Date(e.created_at).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <div>
                  <div className="text-ink-900">{EVENT_LABELS[e.event_type] || e.event_type}</div>
                  {e.actor_name && <div className="text-[11px] text-ink-500">{e.actor_name}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mt-6">
      <h2 className="font-display font-semibold text-sm text-ink-950 mb-3">{title}</h2>
      <div className="bg-white border border-ink-200 rounded-sm p-5">{children}</div>
    </div>
  );
}
