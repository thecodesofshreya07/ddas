import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";
import DownloadAlertModal from "../components/DownloadAlertModal";
import LineageGraph from "../components/LineageGraph";
import StatusBadge from "../components/ui/StatusBadge";
import ClassificationBadge from "../components/ui/ClassificationBadge";
import ErrorState from "../components/ui/ErrorState";
import { SkeletonLine, SkeletonTable } from "../components/ui/Skeleton";

export default function DatasetDetail() {
  const { id } = useParams();
  const [dataset, setDataset] = useState(null);
  const [versions, setVersions] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [pendingVersionId, setPendingVersionId] = useState(null);
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { data } = await api.get(`/datasets/${id}`);
      setDataset(data.dataset);
      setVersions(data.versions);
      const rel = await api.get(`/datasets/${id}/relationships`);
      setRelationships(rel.data.relationships);
    } catch (err) {
      setLoadError(
        err.response?.status === 404
          ? "This dataset doesn't exist, or you don't have access to view it."
          : "We couldn't load this dataset. The service may be temporarily unavailable."
      );
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function triggerDownload(versionId, force = false) {
    setBusy(true);
    try {
      const res = await api.post(
        `/datasets/versions/${versionId}/download`,
        null,
        force ? { params: { force: true }, responseType: "blob" } : {}
      );

      if (!force && res.data?.status === "alert") {
        setAlert(res.data.relationship);
        setPendingVersionId(versionId);
        return;
      }

      // Successful download — force=true path returns a blob
      const blob = new Blob([res.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const version = versions.find((v) => v.id === versionId);
      a.download = version?.original_filename || "dataset";
      a.click();
      URL.revokeObjectURL(url);
      setAlert(null);
      setNotice({ type: "success", text: "Download complete." });
    } catch (err) {
      setNotice({ type: "error", text: err.response?.data?.error || "Download failed." });
    } finally {
      setBusy(false);
    }
  }

  async function handleUseExisting() {
    setBusy(true);
    try {
      await api.post(`/datasets/versions/${pendingVersionId}/reuse`);
      setAlert(null);
      setNotice({ type: "success", text: "Marked as reused — no new download performed. Bandwidth saved." });
    } finally {
      setBusy(false);
    }
  }

  async function handleContinueAnyway() {
    await triggerDownload(pendingVersionId, true);
  }

  if (loadError) return <ErrorState description={loadError} onRetry={load} />;

  if (!dataset) {
    return (
      <div className="space-y-4">
        <SkeletonLine width="40%" height={28} />
        <SkeletonLine width="60%" height={14} />
        <SkeletonTable rows={3} columns={3} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display font-semibold text-2xl text-ink-950">{dataset.title}</h1>
          <p className="text-sm text-ink-600 mt-1 max-w-xl">{dataset.description}</p>
        </div>
        <ClassificationBadge level={dataset.classification} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-ink-600">
        <span className="font-medium bg-ink-100 text-ink-800 px-2 py-0.5 rounded-sm">{dataset.domain}</span>
        <span>·</span>
        <span className="font-medium">{dataset.owner_department}</span>
        {(dataset.period_start || dataset.period_end || versions[0]?.period_start || versions[0]?.period_end) && (
          <>
            <span>·</span>
            <span className="inline-flex items-center gap-1 bg-surface-100 border border-ink-200 px-2 py-0.5 rounded-sm tag-mono text-[11px]">
              📅 {dataset.period_start || versions[0]?.period_start || "—"} to {dataset.period_end || versions[0]?.period_end || "—"}
            </span>
          </>
        )}
        {(dataset.spatial_region_name || versions[0]?.spatial_region_name) && (
          <>
            <span>·</span>
            <span className="inline-flex items-center gap-1 bg-surface-100 border border-ink-200 px-2 py-0.5 rounded-sm tag-mono text-[11px]">
              📍 {dataset.spatial_region_name || versions[0]?.spatial_region_name}
            </span>
          </>
        )}
      </div>


      {notice && (
        <div
          className={`mt-4 text-sm rounded-sm px-3 py-2 border ${
            notice.type === "success"
              ? "text-verify-600 bg-verify-500/10 border-verify-500/30"
              : "text-deny-500 bg-deny-500/10 border-deny-500/30"
          }`}
        >
          {notice.text}
        </div>
      )}

      <h2 className="font-display font-semibold text-lg text-ink-950 mt-8 mb-3">Versions</h2>
      <div className="space-y-2">
        {versions.map((v) => (
          <div
            key={v.id}
            className="bg-white border border-ink-200 rounded-sm p-4 flex items-center justify-between"
          >
            <div>
              <div className="text-sm font-medium text-ink-950">
                v{v.version_num} — {v.original_filename}
              </div>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-ink-600 tag-mono">
                <span>{(v.size_bytes / 1024).toFixed(1)} KB</span>
                <span>·</span>
                <span>sha256:{v.sha256.slice(0, 12)}…</span>
                <span>·</span>
                <span>{new Date(v.uploaded_at).toLocaleDateString()}</span>
              </div>
            </div>
            <button
              onClick={() => triggerDownload(v.id)}
              disabled={busy}
              className="text-sm font-medium bg-ink-900 hover:bg-ink-800 disabled:opacity-50 text-surface-50 px-4 py-2 rounded-sm transition-colors"
            >
              Download
            </button>
          </div>
        ))}
      </div>

      <h2 className="font-display font-semibold text-lg text-ink-950 mt-8 mb-3">
        Related versions
      </h2>
      <LineageGraph currentVersionId={versions[0]?.id} relationships={relationships} />

      {alert && (
        <DownloadAlertModal
          relationship={alert}
          busy={busy}
          onClose={() => setAlert(null)}
          onUseExisting={handleUseExisting}
          onContinueAnyway={handleContinueAnyway}
        />
      )}
    </div>
  );
}
