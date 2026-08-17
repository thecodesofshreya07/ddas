import SimilarityBreakdown from "./SimilarityBreakdown";

export default function DownloadAlertModal({ relationship, onUseExisting, onContinueAnyway, onClose, busy }) {
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
        <p className="text-sm text-ink-600 mb-5">
          A similar or identical dataset already exists in the registry. Review the match
          below before deciding.
        </p>

        <SimilarityBreakdown
          breakdown={relationship.score_breakdown}
          totalScore={parseFloat(relationship.similarity_score)}
          relationshipType={relationship.relationship_type}
        />

        <div className="flex gap-3 mt-6">
          <button
            disabled={busy}
            onClick={onUseExisting}
            className="flex-1 bg-verify-500 hover:bg-verify-600 disabled:opacity-50 text-ink-950 font-medium text-sm py-2.5 rounded-sm transition-colors"
          >
            Use existing dataset
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
