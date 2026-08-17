import { Link } from "react-router-dom";
import {
  Fingerprint,
  ShieldCheck,
  GitBranch,
  Gauge,
  MapPinned,
  FileCheck2,
  ArrowRight,
} from "lucide-react";
import Header from "../components/Header";
import Footer from "../components/Footer";

const FEATURES = [
  {
    icon: Fingerprint,
    title: "Content-based fingerprinting",
    body:
      "Datasets are identified by cryptographic hash and structural fingerprint — not filename — so renamed or re-exported duplicates are still caught.",
  },
  {
    icon: GitBranch,
    title: "Explainable similarity scoring",
    body:
      "Every match shows exactly why it matched: schema overlap, temporal range, spatial extent, and semantic similarity, broken down individually.",
  },
  {
    icon: ShieldCheck,
    title: "Classification-aware access control",
    body:
      "Restricted and confidential datasets are never exposed to unauthorised users — access decisions are policy-driven and fully audited.",
  },
  {
    icon: FileCheck2,
    title: "Tamper-evident audit trail",
    body:
      "Every upload, download, and access decision is recorded in a cryptographically chained log that can be verified at any time.",
  },
  {
    icon: MapPinned,
    title: "Geospatial discovery",
    body:
      "Search for datasets by the geographic region they cover, not just by keyword — useful when department naming conventions differ.",
  },
  {
    icon: Gauge,
    title: "Built for scale",
    body:
      "Candidate filtering narrows comparisons before any expensive analysis runs, so the registry stays fast as it grows.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        {/* Hero */}
        <section className="bg-surface-50 border-b border-ink-200">
          <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="inline-block text-xs font-medium tag-mono text-verify-600 bg-verify-500/10 border border-verify-500/30 px-2.5 py-1 rounded-sm mb-5">
                INTER-DEPARTMENTAL DATA INFRASTRUCTURE
              </span>
              <h1 className="font-display font-semibold text-4xl md:text-5xl text-ink-950 leading-tight">
                Know before you download.
              </h1>
              <p className="text-ink-600 mt-5 text-base leading-relaxed max-w-md">
                DDAS checks every dataset against the national registry before it's
                downloaded or re-collected — by content, structure, and metadata — so
                departments stop paying twice for the same data.
              </p>
              <div className="flex items-center gap-4 mt-8">
                <Link
                  to="/login"
                  className="flex items-center gap-2 bg-ink-900 hover:bg-ink-800 text-surface-50 font-medium text-sm px-5 py-3 rounded-sm transition-colors"
                >
                  Access the registry
                  <ArrowRight size={16} />
                </Link>
                <a
                  href="#about"
                  className="text-sm font-medium text-ink-700 hover:text-verify-600"
                >
                  Learn how it works
                </a>
              </div>
            </div>

            <div className="bg-white border border-ink-200 rounded-sm p-6">
              <div className="text-xs uppercase tracking-wide text-ink-600 font-medium mb-4">
                Live registry snapshot
              </div>
              <div className="grid grid-cols-2 gap-4">
                <MetricTile label="Departments onboarded" value="12" />
                <MetricTile label="Datasets registered" value="4,830" />
                <MetricTile label="Duplicate alerts issued" value="1,204" />
                <MetricTile label="Storage saved" value="2.3 TB" accent />
              </div>
              <div className="text-[11px] text-ink-600 mt-4 tag-mono">
                * Illustrative figures for demonstration purposes
              </div>
            </div>
          </div>
        </section>

        {/* About */}
        <section id="about" className="max-w-6xl mx-auto px-6 py-16">
          <div className="max-w-2xl">
            <h2 className="font-display font-semibold text-2xl text-ink-950">
              Why this exists
            </h2>
            <p className="text-ink-600 mt-3 text-sm leading-relaxed">
              Departments and research bodies routinely re-collect or re-download datasets
              that already exist elsewhere in government infrastructure — often under a
              different filename, in a different format, or as a partial subset. DDAS sits
              in front of the download path and checks for that overlap before the transfer
              happens, so duplication is caught at the point it would otherwise occur, not
              discovered after the fact in a storage audit.
            </p>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="bg-white border-y border-ink-200">
          <div className="max-w-6xl mx-auto px-6 py-16">
            <h2 className="font-display font-semibold text-2xl text-ink-950 mb-10">
              How it works
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              {FEATURES.map((f) => (
                <div key={f.title}>
                  <div className="w-9 h-9 rounded-sm bg-verify-500/10 flex items-center justify-center mb-3">
                    <f.icon size={18} className="text-verify-600" />
                  </div>
                  <div className="font-medium text-sm text-ink-950 mb-1.5">{f.title}</div>
                  <p className="text-xs text-ink-600 leading-relaxed">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display font-semibold text-2xl text-ink-950">
            Departmental access only
          </h2>
          <p className="text-sm text-ink-600 mt-2 max-w-md mx-auto">
            Sign in with your department-issued credentials to search the registry, upload
            datasets, or review duplication reports.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-ink-900 hover:bg-ink-800 text-surface-50 font-medium text-sm px-6 py-3 rounded-sm transition-colors mt-6"
          >
            Sign in
            <ArrowRight size={16} />
          </Link>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function MetricTile({ label, value, accent }) {
  return (
    <div>
      <div className={`font-display font-semibold text-2xl ${accent ? "text-verify-600" : "text-ink-950"}`}>
        {value}
      </div>
      <div className="text-[11px] text-ink-600 mt-0.5">{label}</div>
    </div>
  );
}
