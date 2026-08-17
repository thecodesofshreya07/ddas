export default function EmptyState({ title, description, action }) {
  return (
    <div className="text-center py-12 px-6 bg-surface-50 border border-dashed border-ink-200 rounded-sm">
      <div className="text-sm font-medium text-ink-900">{title}</div>
      {description && (
        <p className="text-xs text-ink-600 mt-1.5 max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
