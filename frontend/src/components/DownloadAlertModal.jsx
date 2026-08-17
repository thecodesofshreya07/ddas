import SimilarityBreakdown from "./SimilarityBreakdown";

export default function DownloadAlertModal({ relationship, onUseExisting, onContinueAnyway, onClose, busy }) {
  const periodText = relationship?.existing?.periodStart && relationship?.existing?.periodEnd
    ? `${relationship.existing.periodStart} to ${relationship.existing.periodEnd}`
    : relationship?.existing?.periodStart || relationship?.existing?.periodEnd || "";
  const regionText = relationship?.existing?.spatialRegionName || "";
  const hasAccess = relationship?.existing?.hasAccess !== false;

  return (
    <div className="fixed inset-0 bg-ink-950/60 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-sm max-w-lg w-full p-6">
        <div className="flex items-start justify-between mb-1">
          <h2 className="font-display font-semibold text-lg text-ink-950">
            Before you download
          </h2>
          <button onClick={onClose} className="text-ink-600 hover:text-ink-950 text-sm">
            ✕
          </button>
        </div>
        <p className="text-sm text-ink-600 mb-4">
          A similar or identical dataset already exists in the institute registry. Review the match
          below before deciding.
        </p>

        {(periodText || regionText) && (
          <div className="bg-surface-100 border border-ink-200 rounded-sm p-3 mb-4 text-xs text-ink-700 flex flex-wrap gap-3 tag-mono">
            {periodText && <span>📅 Period: <strong>{periodText}</strong></span>}
            {regionText && <span>📍 Region: <strong>{regionText}</strong></span>}
          </div>
        )}

        <SimilarityBreakdown
          breakdown={relationship.score_breakdown}
          totalScore={parseFloat(relationship.similarity_score)}
          relationshipType={relationship.relationship_type}
        />

        {!hasAccess && (
          <div className="mt-4 p-3 bg-deny-500/10 border border-deny-500/30 rounded-sm text-xs text-deny-600">
            🔒 <strong>Access Controlled:</strong> Classification is restricted. Contact the data custodian department to request official access.
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            disabled={busy}
            onClick={onUseExisting}
            className="flex-1 bg-verify-500 hover:bg-verify-600 disabled:opacity-50 text-ink-950 font-medium text-sm py-2.5 rounded-sm transition-colors"
          >
            {hasAccess ? "Use existing dataset" : "Acknowledge & Cancel"}
          </button>
          <button
            disabled={busy}
            onClick={onContinueAnyway}
            className="flex-1 border border-ink-200 hover:border-ink-400 disabled:opacity-50 text-ink-700 font-medium text-sm py-2.5 rounded-sm transition-colors"
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}

