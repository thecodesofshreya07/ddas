import { AlertCircle } from "lucide-react";

export default function ErrorState({ title = "Something went wrong", description, referenceId, onRetry }) {
  return (
    <div className="text-center py-10 px-6 bg-deny-500/5 border border-deny-500/20 rounded-sm">
      <AlertCircle size={20} className="text-deny-600 mx-auto mb-2" />
      <div className="text-sm font-medium text-ink-900">{title}</div>
      {description && (
        <p className="text-xs text-ink-600 mt-1.5 max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {referenceId && (
        <div className="text-[11px] text-ink-500 mt-2 tag-mono">Reference: {referenceId}</div>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 text-xs font-medium text-deny-700 hover:text-deny-600 border border-deny-500/30 px-3 py-1.5 rounded-sm"
        >
          Retry
        </button>
      )}
    </div>
  );
}
