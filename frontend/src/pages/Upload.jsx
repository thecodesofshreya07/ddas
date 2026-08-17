import { useState, useRef, useEffect } from "react";
import { Check, ChevronLeft, ChevronRight, UploadCloud, FileText } from "lucide-react";
import api from "../api/client";
import SimilarityBreakdown from "../components/SimilarityBreakdown";
import ClassificationBadge from "../components/ui/ClassificationBadge";
import DiffView from "../components/DiffView";

const DOMAINS = ["Meteorology", "GIS", "Census", "Agriculture", "Health", "Infrastructure", "Other"];
const CLASSIFICATIONS = ["public", "internal", "restricted", "confidential"];

const STEPS = [
  { key: "file", label: "Select file" },
  { key: "describe", label: "Describe it" },
  { key: "review", label: "Review & upload" },
];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center mb-8" aria-label="Upload progress">
      {STEPS.map((s, i) => {
        const isDone = i < current;
        const isActive = i === current;
        return (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                  isDone
                    ? "bg-verify-500 text-ink-950"
                    : isActive
                    ? "bg-ink-900 text-surface-50"
                    : "bg-surface-100 text-ink-500 border border-ink-200"
                }`}
              >
                {isDone ? <Check size={14} /> : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:inline ${isActive ? "text-ink-950" : "text-ink-500"}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 mx-3 ${isDone ? "bg-verify-500" : "bg-ink-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Upload() {
  const fileRef = useRef(null);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [form, setForm] = useState({
    title: "",
    description: "",
    domain: "Meteorology",
    classification: "internal",
    period_start: "",
    period_end: "",
    spatial_region_name: "",
    spatial_min_lat: "",
    spatial_max_lat: "",
    spatial_min_lng: "",
    spatial_max_lng: "",
  });

  const [phase, setPhase] = useState("idle"); // idle | uploading | analyzing | exact_duplicate | done
  const [exactDuplicate, setExactDuplicate] = useState(null);
  const [versionId, setVersionId] = useState(null);
  const [relationship, setRelationship] = useState(null);
  const [error, setError] = useState(null);
  const [discarding, setDiscarding] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleFileSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    // Pre-fill title from filename so the next step isn't a blank slate.
    if (!form.title) {
      update("title", f.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "));
    }

    // Auto-infer period from CSV date column if available
    if (f.name.endsWith(".csv") || f.type === "text/csv") {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const text = event.target.result;
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 500);
          if (lines.length > 1) {
            const delim = lines[0].includes("\t") ? "\t" : ",";
            const cols = lines[0].split(delim).map((c) => c.trim().replace(/^["']|["']$/g, ""));
            const dateColIdx = cols.findIndex((c) => /date|time|timestamp|year|month|period|datetime/i.test(c));
            if (dateColIdx !== -1) {
              const dates = [];
              for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(delim);
                const raw = parts[dateColIdx]?.trim().replace(/^["']|["']$/g, "");
                if (raw) {
                  const ts = Date.parse(raw);
                  if (!isNaN(ts)) dates.push(new Date(ts));
                }
              }
              if (dates.length > 0) {
                dates.sort((a, b) => a.getTime() - b.getTime());
                const minD = dates[0].toISOString().split("T")[0];
                const maxD = dates[dates.length - 1].toISOString().split("T")[0];
                setForm((prev) => ({
                  ...prev,
                  period_start: prev.period_start || minD,
                  period_end: prev.period_end || maxD,
                }));
              }
            }
          }
        } catch {}
      };
      reader.readAsText(f.slice(0, 300000));
    }
  }

  function canAdvance() {
    if (step === 0) return !!file;
    if (step === 1) return form.title.trim().length > 0;
    return true;
  }

  async function handleUpload() {
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(form).forEach(([k, v]) => {
      if (v !== "") fd.append(k, v);
    });

    setPhase("uploading");
    try {
      const { data } = await api.post("/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (data.status === "exact_duplicate") {
        setExactDuplicate(data.existing);
        setPhase("exact_duplicate");
        return;
      }


      setVersionId(data.datasetVersionId);
      setPhase("analyzing");
    } catch (err) {
      setError(err.response?.data?.error || "Upload failed");
      setPhase("idle");
    }
  }

  useEffect(() => {
    if (phase !== "analyzing" || !versionId) return;
    let cancelled = false;
    let attempt = 0;

    async function poll() {
      try {
        const { data } = await api.get(`/upload/${versionId}/status`);
        if (cancelled) return;
        if (data.fingerprintReady) {
          setRelationship(data.relationship);
          setPhase("done");
        } else {
          attempt += 1;
          const delay = Math.min(1500 + attempt * 500, 5000);
          setTimeout(poll, delay);
        }
      } catch {
        setTimeout(poll, 3000);
      }
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [phase, versionId]);

  async function handleDiscard() {
    setDiscarding(true);
    try {
      await api.delete(`/datasets/versions/${versionId}`);
      reset();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't discard this upload.");
    } finally {
      setDiscarding(false);
    }
  }

  function reset() {
    setStep(0);
    setFile(null);
    setPhase("idle");
    setExactDuplicate(null);
    setVersionId(null);
    setRelationship(null);
    setError(null);
    setShowAdvanced(false);
    setForm({
      title: "",
      description: "",
      domain: "Meteorology",
      classification: "internal",
      period_start: "",
      period_end: "",
      spatial_region_name: "",
      spatial_min_lat: "",
      spatial_max_lat: "",
      spatial_min_lng: "",
      spatial_max_lng: "",
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---- Result screens (post-submit) ----
  if (phase === "exact_duplicate" && exactDuplicate) {
    return (
      <div className="max-w-xl">
        <div className="bg-deny-500/5 border border-deny-500/30 rounded-sm p-6">
          <div className="text-deny-600 font-semibold text-sm mb-1">Exact duplicate found</div>
          <p className="text-sm text-ink-700 mb-4">
            An identical file already exists in the registry. No new copy was stored.
          </p>
          <div className="bg-white rounded-sm border border-ink-200 p-4 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">{exactDuplicate.title}</span>
              <ClassificationBadge level={exactDuplicate.classification} />
            </div>
            <div className="text-xs text-ink-600 tag-mono">
              {exactDuplicate.ownerDepartment} · uploaded{" "}
              {new Date(exactDuplicate.uploadedAt).toLocaleString()}
            </div>
          </div>
          <button onClick={reset} className="mt-4 text-sm font-medium text-verify-600 hover:text-verify-500">
            Upload something else →
          </button>
        </div>
      </div>
    );
  }

  if (phase === "analyzing") {
    return (
      <div className="max-w-xl">
        <div className="bg-white border border-ink-200 rounded-sm p-6 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-verify-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-ink-700">
            No exact match. Running structural + semantic similarity analysis in the background…
          </span>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="max-w-xl">
        <div className="bg-white border border-ink-200 rounded-sm p-6">
          {relationship ? (
            <>
              <div className="text-alert-600 font-semibold text-sm mb-4">
                {relationship.relationship_type === "new_version"
                  ? "This looks like a minor edit of an existing dataset"
                  : "Possible duplicate or related dataset detected"}
              </div>
              <SimilarityBreakdown
                breakdown={relationship.score_breakdown}
                totalScore={parseFloat(relationship.similarity_score)}
                relationshipType={relationship.relationship_type}
              />

              {relationship.content_diff && (
                <div className="mt-5 pt-5 border-t border-ink-100">
                  <div className="text-xs uppercase tracking-wide text-ink-600 font-medium mb-3">
                    What actually changed
                  </div>
                  <DiffView diff={relationship.content_diff} />
                </div>
              )}

              <div className="flex gap-3 mt-6 pt-5 border-t border-ink-100">
                <button
                  onClick={reset}
                  className="flex-1 bg-ink-900 hover:bg-ink-800 text-surface-50 font-medium text-sm py-2.5 rounded-sm transition-colors"
                >
                  Keep as new version
                </button>
                <button
                  onClick={handleDiscard}
                  disabled={discarding}
                  className="flex-1 border border-deny-500/40 text-deny-600 hover:bg-deny-500/5 disabled:opacity-50 font-medium text-sm py-2.5 rounded-sm transition-colors"
                >
                  {discarding ? "Discarding…" : "Discard this upload"}
                </button>
              </div>
              <p className="text-[11px] text-ink-500 mt-2">
                Discarding removes the file you just uploaded and keeps only the existing
                version in the registry — use this if the changes above aren't worth a new copy.
              </p>
              {error && (
                <div className="text-sm text-deny-500 bg-deny-500/10 border border-deny-500/30 rounded-sm px-3 py-2 mt-3">
                  {error}
                </div>
              )}
            </>
          ) : (
            <div className="text-verify-600 font-semibold text-sm">
              No similar dataset found. Registered as a new, distinct entry.
            </div>
          )}
          {!relationship && (
            <button onClick={reset} className="mt-5 text-sm font-medium text-verify-600 hover:text-verify-500">
              Upload another →
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- Wizard ----
  return (
    <div className="max-w-xl">
      <h1 className="font-display font-semibold text-2xl text-ink-950">Upload dataset</h1>
      <p className="text-sm text-ink-600 mt-1 mb-6">
        A few quick steps — most fields are optional and can stay blank.
      </p>

      <StepIndicator current={step} />

      <div className="bg-white border border-ink-200 rounded-sm p-6">
        {/* Step 1: file */}
        {step === 0 && (
          <div>
            <label
              htmlFor="file-input"
              className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-sm py-12 cursor-pointer transition-colors ${
                file ? "border-verify-500 bg-verify-500/5" : "border-ink-200 hover:border-ink-400"
              }`}
            >
              {file ? (
                <>
                  <FileText size={28} className="text-verify-600" />
                  <div className="text-sm font-medium text-ink-950">{file.name}</div>
                  <div className="text-xs text-ink-600 tag-mono">{(file.size / 1024).toFixed(1)} KB</div>
                </>
              ) : (
                <>
                  <UploadCloud size={28} className="text-ink-400" />
                  <div className="text-sm text-ink-700">
                    <span className="text-verify-600 font-medium">Choose a file</span> or drag it here
                  </div>
                  <div className="text-xs text-ink-500">CSV, JSON, PDF, PNG, or JPEG</div>
                </>
              )}
              <input
                id="file-input"
                ref={fileRef}
                type="file"
                accept=".csv,.json,.pdf,.png,.jpg,.jpeg"
                onChange={handleFileSelect}
                className="sr-only"
              />
            </label>
          </div>
        )}

        {/* Step 2: describe — only the essentials */}
        {step === 1 && (
          <div className="space-y-5">
            <Field label="Title" required>
              <input
                required
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                className="input"
                placeholder="Mumbai Rainfall Observations 2024"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Domain">
                <select value={form.domain} onChange={(e) => update("domain", e.target.value)} className="input">
                  {DOMAINS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </Field>
              <Field label="Classification">
                <select
                  value={form.classification}
                  onChange={(e) => update("classification", e.target.value)}
                  className="input"
                >
                  {CLASSIFICATIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div>
              <ClassificationBadge level={form.classification} />
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-medium text-verify-700 hover:text-verify-600"
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? "− Hide" : "+ Add"} description, time period &amp; location (optional)
            </button>

            {showAdvanced && (
              <div className="space-y-4 pt-1 border-t border-ink-100">
                <Field label="Description">
                  <textarea
                    value={form.description}
                    onChange={(e) => update("description", e.target.value)}
                    className="input min-h-[64px] mt-4"
                    placeholder="Daily rainfall observations across Mumbai Metropolitan Region…"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Period start">
                    <input
                      type="date"
                      value={form.period_start}
                      onChange={(e) => update("period_start", e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Period end">
                    <input
                      type="date"
                      value={form.period_end}
                      onChange={(e) => update("period_end", e.target.value)}
                      className="input"
                    />
                  </Field>
                </div>
                <Field label="Spatial region name">
                  <input
                    value={form.spatial_region_name}
                    onChange={(e) => update("spatial_region_name", e.target.value)}
                    className="input"
                    placeholder="Mumbai Metropolitan Region"
                  />
                </Field>
                <div>
                  <div className="text-xs font-medium text-ink-600 mb-1.5">
                    Bounding box (enables geospatial duplicate/search matching)
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      ["spatial_min_lat", "min lat"],
                      ["spatial_max_lat", "max lat"],
                      ["spatial_min_lng", "min lng"],
                      ["spatial_max_lng", "max lng"],
                    ].map(([field, ph]) => (
                      <input
                        key={field}
                        type="number"
                        step="any"
                        value={form[field]}
                        onChange={(e) => update(field, e.target.value)}
                        placeholder={ph}
                        className="input tag-mono text-xs"
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: review */}
        {step === 2 && (
          <div>
            <div className="space-y-3 text-sm mb-5">
              <ReviewRow label="File" value={file?.name} />
              <ReviewRow label="Title" value={form.title} />
              <ReviewRow label="Domain" value={form.domain} />
              <ReviewRow label="Classification" value={<ClassificationBadge level={form.classification} />} />
              {form.description && <ReviewRow label="Description" value={form.description} />}
              {(form.period_start || form.period_end) && (
                <ReviewRow label="Period" value={`${form.period_start || "—"} to ${form.period_end || "—"}`} />
              )}
              {form.spatial_region_name && <ReviewRow label="Region" value={form.spatial_region_name} />}
            </div>

            {error && (
              <div className="text-sm text-deny-500 bg-deny-500/10 border border-deny-500/30 rounded-sm px-3 py-2 mb-4">
                {error}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={phase === "uploading"}
              className="w-full bg-ink-900 hover:bg-ink-800 disabled:opacity-50 text-surface-50 font-medium text-sm py-2.5 rounded-sm transition-colors"
            >
              {phase === "uploading" ? "Checking & uploading…" : "Check & upload"}
            </button>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 pt-5 border-t border-ink-100">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1 text-sm text-ink-600 hover:text-ink-950 disabled:opacity-0"
          >
            <ChevronLeft size={16} />
            Back
          </button>
          {step < STEPS.length - 1 && (
            <button
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              disabled={!canAdvance()}
              className="flex items-center gap-1 text-sm font-medium text-verify-700 hover:text-verify-600 disabled:opacity-40"
            >
              Next
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-600 mb-1.5">
        {label}
        {required && <span className="text-deny-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-ink-100 last:border-0">
      <span className="text-ink-600 text-xs shrink-0 pt-0.5">{label}</span>
      <span className="text-ink-950 text-right">{value}</span>
    </div>
  );
}
