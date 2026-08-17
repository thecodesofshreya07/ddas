import { useState } from "react";
import api from "../api/client";

export default function AuditLog() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function verify() {
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.get("/datasets/audit/verify");
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="font-display font-semibold text-2xl text-ink-950">Audit log integrity</h1>
      <p className="text-sm text-ink-600 mt-1 mb-6">
        Every sensitive action is recorded in a hash-chained log — each entry commits to the
        hash of the one before it. Altering any past entry breaks every hash after it. This
        walks the entire chain and verifies nothing has been tampered with.
      </p>

      <button
        onClick={verify}
        disabled={loading}
        className="bg-ink-900 hover:bg-ink-800 disabled:opacity-50 text-surface-50 font-medium text-sm px-5 py-2.5 rounded-sm transition-colors"
      >
        {loading ? "Walking the chain…" : "Verify chain"}
      </button>

      {result && (
        <div
          className={`mt-5 rounded-sm border p-5 ${
            result.valid
              ? "bg-verify-500/5 border-verify-500/30"
              : "bg-deny-500/5 border-deny-500/30"
          }`}
        >
          {result.valid ? (
            <>
              <div className="text-verify-600 font-semibold text-sm mb-1">Chain intact</div>
              <p className="text-sm text-ink-700">
                Verified <span className="tag-mono">{result.rowsVerified}</span> entries — no
                tampering detected.
              </p>
            </>
          ) : (
            <>
              <div className="text-deny-600 font-semibold text-sm mb-1">
                Tampering detected
              </div>
              <p className="text-sm text-ink-700">
                Chain broke at entry <span className="tag-mono">#{result.brokenAt}</span>:{" "}
                {result.reason}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
