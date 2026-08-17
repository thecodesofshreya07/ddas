import { CheckCircle2, AlertTriangle, AlertCircle, Info, Circle } from "lucide-react";

/**
 * Every status in the app renders through this component. Accessibility
 * rule from the design brief: never use color alone to convey meaning —
 * always pair color + icon + text.
 */
const VARIANTS = {
  success: { icon: CheckCircle2, classes: "bg-verify-500/10 text-verify-700 border-verify-500/30" },
  warning: { icon: AlertTriangle, classes: "bg-alert-500/10 text-alert-700 border-alert-500/30" },
  danger: { icon: AlertCircle, classes: "bg-deny-500/10 text-deny-700 border-deny-500/30" },
  info: { icon: Info, classes: "bg-ink-600/10 text-ink-700 border-ink-300" },
  neutral: { icon: Circle, classes: "bg-surface-100 text-ink-600 border-ink-200" },
};

export default function StatusBadge({ variant = "neutral", children, className = "" }) {
  const v = VARIANTS[variant] || VARIANTS.neutral;
  const Icon = v.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-sm border tag-mono ${v.classes} ${className}`}
    >
      <Icon size={12} />
      {children}
    </span>
  );
}
