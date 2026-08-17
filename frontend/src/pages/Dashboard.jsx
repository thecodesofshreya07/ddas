import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/ui/StatusBadge";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import { SkeletonCard, SkeletonLine } from "../components/ui/Skeleton";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} day(s) ago`;
}

const EVENT_LABELS = {
  UPLOAD: "Dataset uploaded",
  DUPLICATE_DETECTED: "Duplicate/similar dataset detected",
  DOWNLOAD_ALERT_SHOWN: "Pre-download alert shown",
  DOWNLOAD_ALLOWED: "Download completed",
  DOWNLOAD_DENIED: "Download denied (access policy)",
  DATASET_REUSED: "Existing dataset reused",
  LOGIN: "Signed in",
  ACCESS_DENIED: "Access denied (restricted dataset)",
};

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [attention, setAttention] = useState(null);
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState(null);

  async function loadAll() {
    setError(null);
    try {
      const [statsRes, attentionRes, activityRes] = await Promise.all([
        api.get("/datasets/dashboard/stats"),
        api.get("/datasets/dashboard/attention"),
        api.get("/datasets/audit/recent?limit=8"),
      ]);
      setStats(statsRes.data);
      setAttention(attentionRes.data);
      setActivity(activityRes.data.events);
    } catch (err) {
      setError(err.response?.data?.error || "We couldn't load the dashboard data.");
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const attentionCount =
    (attention?.highSimilarityMatches?.length || 0) + (attention?.continuedDespiteAlert?.length || 0);

  return (
    <div>
      {/* Context header */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display font-semibold text-2xl text-ink-950">
            Welcome, {user?.name?.split(" ")[0]}
          </h1>
          <p className="text-sm text-ink-600 mt-1">
            {user?.department} · signed in as {user?.role}
          </p>
        </div>
        <StatusBadge variant="success">System operational</StatusBadge>
      </div>

      {error && (
        <div className="mt-6">
          <ErrorState description={error} onRetry={loadAll} />
        </div>
      )}

      {/* Primary + secondary metrics — hierarchy, not equal-sized cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
        {!stats ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <div className="sm:col-span-1 bg-white border border-ink-200 rounded-sm p-5">
              <div className="text-xs text-ink-600 uppercase tracking-wide font-medium">
                Bandwidth &amp; storage saved
              </div>
              <div className="font-display font-semibold text-3xl text-verify-700 mt-2">
                {formatBytes(stats.bandwidthSavedBytes)}
              </div>
            </div>
            <div className="bg-white border border-ink-200 rounded-sm p-5">
              <div className="text-xs text-ink-600 uppercase tracking-wide font-medium">
                Duplicate downloads prevented
              </div>
              <div className="font-display font-semibold text-2xl text-ink-950 mt-2">
                {stats.duplicateDownloadsPrevented}
              </div>
            </div>
            <div className="bg-white border border-ink-200 rounded-sm p-5">
              <div className="text-xs text-ink-600 uppercase tracking-wide font-medium">
                Items requiring attention
              </div>
              <div className="font-display font-semibold text-2xl text-alert-600 mt-2">
                {attentionCount}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {/* Requires attention */}
        <section>
          <h2 className="font-display font-semibold text-sm text-ink-950 mb-3">
            Requires attention
          </h2>
          <div className="bg-white border border-ink-200 rounded-sm divide-y divide-ink-100">
            {!attention ? (
              <div className="p-4 space-y-2">
                <SkeletonLine width="80%" />
                <SkeletonLine width="60%" />
              </div>
            ) : attentionCount === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Nothing needs review right now"
                  description="No high-similarity matches or overridden download alerts in the recent period."
                />
              </div>
            ) : (
              <>
                {attention.highSimilarityMatches.map((m) => (
                  <div key={m.id} className="p-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusBadge variant="warning">High similarity</StatusBadge>
                        <span className="text-[11px] text-ink-500">{timeAgo(m.created_at)}</span>
                      </div>
                      <div className="text-sm text-ink-900 mt-1.5">{m.title}</div>
                      <div className="text-xs text-ink-600 tag-mono mt-0.5">
                        {parseFloat(m.similarity_score).toFixed(1)}% match ·{" "}
                        {m.relationship_type.replace(/_/g, " ")}
                      </div>
                    </div>
                    <Link
                      to={`/alerts/${m.id}`}
                      className="text-xs font-medium text-verify-700 hover:text-verify-600 shrink-0"
                    >
                      Review →
                    </Link>
                  </div>
                ))}
                {attention.continuedDespiteAlert.map((d) => (
                  <div key={d.id} className="p-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusBadge variant="danger">Alert overridden</StatusBadge>
                        <span className="text-[11px] text-ink-500">{timeAgo(d.downloaded_at)}</span>
                      </div>
                      <div className="text-sm text-ink-900 mt-1.5">{d.title}</div>
                      <div className="text-xs text-ink-600 mt-0.5">
                        {d.user_name} downloaded despite a duplicate alert
                      </div>
                    </div>
                    <Link
                      to={`/datasets/${d.dataset_id}`}
                      className="text-xs font-medium text-verify-700 hover:text-verify-600 shrink-0"
                    >
                      View →
                    </Link>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        {/* Activity timeline */}
        <section>
          <h2 className="font-display font-semibold text-sm text-ink-950 mb-3">
            Recent activity
          </h2>
          <div className="bg-white border border-ink-200 rounded-sm p-4">
            {!activity ? (
              <div className="space-y-2">
                <SkeletonLine width="90%" />
                <SkeletonLine width="75%" />
                <SkeletonLine width="85%" />
              </div>
            ) : activity.length === 0 ? (
              <EmptyState title="No recorded activity yet" description="Actions you take will appear here." />
            ) : (
              <ol className="space-y-3">
                {activity.map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="tag-mono text-[11px] text-ink-500 w-16 shrink-0 pt-0.5">
                      {new Date(e.created_at).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div>
                      <div className="text-ink-900">{EVENT_LABELS[e.event_type] || e.event_type}</div>
                      {e.actor_name && (
                        <div className="text-[11px] text-ink-500">{e.actor_name}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>

      {/* Charts — compact, secondary */}
      {stats && (stats.topDuplicatedDatasets.length > 0 || stats.departmentUsage.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <div className="bg-white border border-ink-200 rounded-sm p-5">
            <h2 className="font-display font-semibold text-sm text-ink-950 mb-4">
              Most duplicated datasets
            </h2>
            {stats.topDuplicatedDatasets.length === 0 ? (
              <EmptyState title="No duplicate alerts recorded yet" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats.topDuplicatedDatasets} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} stroke="#ECEFF4" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="title"
                    tick={{ fontSize: 11 }}
                    width={130}
                    tickFormatter={(v) => (v.length > 16 ? v.slice(0, 16) + "…" : v)}
                  />
                  <Tooltip />
                  <Bar dataKey="alert_count" radius={[0, 3, 3, 0]}>
                    {stats.topDuplicatedDatasets.map((_, i) => (
                      <Cell key={i} fill="#F59E0B" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white border border-ink-200 rounded-sm p-5">
            <h2 className="font-display font-semibold text-sm text-ink-950 mb-4">
              Datasets by department
            </h2>
            {stats.departmentUsage.length === 0 ? (
              <EmptyState title="No datasets registered yet" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats.departmentUsage}>
                  <CartesianGrid vertical={false} stroke="#ECEFF4" />
                  <XAxis dataKey="owner_department" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="dataset_count" radius={[3, 3, 0, 0]}>
                    {stats.departmentUsage.map((_, i) => (
                      <Cell key={i} fill="#14B8A6" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
