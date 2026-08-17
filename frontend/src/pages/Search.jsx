import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import DataTable from "../components/ui/DataTable";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import ClassificationBadge from "../components/ui/ClassificationBadge";
import { SkeletonTable } from "../components/ui/Skeleton";

const DOMAINS = ["", "Meteorology", "GIS", "Census", "Agriculture", "Health", "Infrastructure", "Other"];

const columns = [
  { key: "title", label: "Title", sortable: true },
  { key: "domain", label: "Domain", sortable: true },
  { key: "owner_department", label: "Department", sortable: true },
  {
    key: "classification",
    label: "Classification",
    sortable: true,
    render: (r) => <ClassificationBadge level={r.classification} />,
  },
  { key: "spatial_region_name", label: "Region", render: (r) => r.spatial_region_name || "—" },
  {
    key: "period",
    label: "Period",
    render: (r) =>
      r.period_start || r.period_end
        ? `${r.period_start || "—"} to ${r.period_end || "—"}`
        : "—",
  },
];

export default function Search() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [showGeo, setShowGeo] = useState(false);
  const [bbox, setBbox] = useState({ minLat: "", maxLat: "", minLng: "", maxLng: "" });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);

  async function runSearch(e) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const params = {
        q: q || undefined,
        domain: domain || undefined,
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
      };
      if (showGeo && bbox.minLat && bbox.maxLat && bbox.minLng && bbox.maxLng) {
        Object.assign(params, bbox);
      }
      const { data } = await api.get("/datasets/search", { params });
      setResults(data.results || []);
      setSearched(true);
    } catch (err) {
      setError(err.response?.data?.error || "We couldn't complete the search. The service may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  return (
    <div>
      <h1 className="font-display font-semibold text-2xl text-ink-950">Search the registry</h1>
      <p className="text-sm text-ink-600 mt-1 mb-6">
        Find an existing dataset before downloading or re-collecting one.
      </p>

      <form onSubmit={runSearch} className="bg-white border border-ink-200 rounded-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, description, region…"
            className="input flex-1"
            aria-label="Search query"
          />
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="input sm:w-48"
            aria-label="Filter by domain"
          >
            {DOMAINS.map((d) => (
              <option key={d} value={d}>
                {d || "All domains"}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="bg-ink-900 hover:bg-ink-800 text-surface-50 font-medium text-sm px-5 py-2 rounded-sm transition-colors"
          >
            Search
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowGeo((v) => !v)}
          className="text-xs font-medium text-verify-700 hover:text-verify-600"
          aria-expanded={showGeo}
        >
          {showGeo ? "− Hide" : "+ Add"} geospatial filter
        </button>

        {showGeo && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ["minLat", "min lat"],
              ["maxLat", "max lat"],
              ["minLng", "min lng"],
              ["maxLng", "max lng"],
            ].map(([field, ph]) => (
              <input
                key={field}
                type="number"
                step="any"
                value={bbox[field]}
                onChange={(e) => setBbox((b) => ({ ...b, [field]: e.target.value }))}
                placeholder={ph}
                aria-label={ph}
                className="input tag-mono text-xs"
              />
            ))}
          </div>
        )}
      </form>

      <div className="mt-6">
        {loading && <SkeletonTable rows={4} columns={5} />}

        {!loading && error && <ErrorState description={error} onRetry={runSearch} />}

        {!loading && !error && searched && results?.length === 0 && (
          <EmptyState
            title="No matching datasets found"
            description="Try broadening your search terms or removing filters. If you're about to upload this data, the registry will check for duplicates automatically."
          />
        )}

        {!loading && !error && results?.length > 0 && (
          <DataTable
            columns={columns}
            rows={results}
            rowKey="dataset_id"
            onRowClick={(r) => navigate(`/datasets/${r.dataset_id}`)}
          />
        )}

        {!loading && !searched && (
          <EmptyState
            title="Search to get started"
            description="Enter a keyword above, or add a geospatial filter, to browse the registry."
          />
        )}
      </div>
    </div>
  );
}
