import { Unlock, Building2, Lock, ShieldAlert } from "lucide-react";
import { useState } from "react";

/**
 * Distinct from the generic StatusBadge (success/warning/danger) — this is
 * a specific government data-sensitivity taxonomy, with its own icon
 * language and an inline explanation, since "restricted" and "confidential"
 * mean something precise here, not just "warning".
 */
export const CLASSIFICATIONS = {
  public: {
    label: "Public",
    icon: Unlock,
    classes: "bg-verify-500/10 text-verify-700 border-verify-500/30",
    description: "Open access. Any authenticated user in any department may view and download.",
  },
  internal: {
    label: "Internal",
    icon: Building2,
    classes: "bg-ink-600/10 text-ink-700 border-ink-300",
    description: "Departmental use. Visible to all authenticated users, intended for internal government work.",
  },
  restricted: {
    label: "Restricted",
    icon: Lock,
    classes: "bg-alert-500/10 text-alert-700 border-alert-500/30",
    description: "Access limited to department administrators and above. Standard users cannot view or download.",
  },
  confidential: {
    label: "Confidential",
    icon: ShieldAlert,
    classes: "bg-deny-500/10 text-deny-700 border-deny-500/30",
    description: "Highest sensitivity. Restricted to system administrators only; existence is not revealed to unauthorized users.",
  },
};

export default function ClassificationBadge({ level, withTooltip = true, className = "" }) {
  const [open, setOpen] = useState(false);
  const c = CLASSIFICATIONS[level] || CLASSIFICATIONS.internal;
  const Icon = c.icon;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-sm border tag-mono ${c.classes} ${className}`}
        aria-describedby={withTooltip ? `classification-${level}` : undefined}
      >
        <Icon size={12} />
        {c.label}
      </button>
      {withTooltip && open && (
        <div
          id={`classification-${level}`}
          role="tooltip"
          className="absolute z-20 top-full mt-1.5 left-0 w-56 bg-ink-950 text-surface-200 text-[11px] leading-relaxed rounded-sm px-2.5 py-2 shadow-lg"
        >
          {c.description}
        </div>
      )}
    </span>
  );
}
