# DDAS — Data Download Duplication Alert System

Backend scaffold (Day 1–3 of the build plan). This is a working system, not a mock:
real Postgres, real MinIO (S3-compatible), real Elasticsearch, real Redis/BullMQ
async processing, real AES-256 encryption at rest, real hash-chained audit log.

## Quick start

```bash
cd ddas
cp backend/.env.example backend/.env

# Generate a real encryption key and paste it into backend/.env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# -> paste into FILE_ENCRYPTION_KEY=

docker compose up --build
```

This brings up: Postgres (schema auto-applied on first boot), Redis, MinIO,
Elasticsearch, the API (internal only — see note below), the fingerprint worker, and the
frontend (`:5173`).

**If you already had this stack running before the Alert Center was added**, your
Postgres data volume exists and won't re-run the schema init script. Apply the new
tables/columns manually (safe, idempotent, doesn't touch existing data):

```bash
docker compose exec -T postgres psql -U ddas -d ddas < backend/src/db/migrations/002_alert_reviews.sql
docker compose exec -T postgres psql -U ddas -d ddas < backend/src/db/migrations/003_content_diff.sql
```

Seed demo users:

```bash
docker compose exec api npm run seed
```

Check everything is alive:

```bash
docker compose exec api wget -qO- http://localhost:4000/health
```

(The `api` service intentionally has no fixed host port mapping anymore — it would
collide when horizontally scaled. See "Scaling demo" below for how to reach it from
your host machine.)

## What's implemented (backend)

- **Auth**: JWT, bcrypt password hashing, rate-limited login (`/api/auth`)
- **Registry**: `datasets` / `dataset_versions` / `version_relationships` schema with
  dataset-vs-version-vs-file separation (see `src/db/schema.sql`)
- **Upload pipeline**: streamed SHA-256, AES-256-GCM encryption at rest, MinIO storage,
  exact-duplicate short-circuit, async job handoff (`src/routes/upload.js`)
- **Duplicate engine**: candidate filtering (size/domain), structural CSV fingerprinting,
  TF-IDF semantic similarity, explainable weighted scoring, duplicate/version/subset/
  superset/related classification (`src/services/duplicateEngine.js`)
- **Async processing**: BullMQ + Redis worker doing the expensive fingerprint/similarity
  work off the request path (`src/workers/fingerprintWorker.js`)
- **Search**: real Elasticsearch indexing + full-text/fuzzy/filtered search, **plus a real
  `geo_shape` field and `intersects` query** — dataset spatial extents are indexed as
  GeoJSON envelopes, and search supports "find datasets covering this region" as a genuine
  geospatial query, not app-side bbox math (`src/services/search.js`)
- **ABAC policy engine**: role + department + classification + action → allow/deny,
  deny-by-default, 404-not-403 to avoid leaking restricted dataset existence
  (`src/middleware/policy.js`)
- **Audit log**: hash-chained, tamper-evident, with a `/api/datasets/audit/verify`
  endpoint that walks the whole chain live (`src/services/auditLog.js`)
- **Rate limiting**: Redis-backed, per-route-group, works correctly across scaled
  API replicas
- **Alert Center workflow**: `alert_reviews` table gives every detected duplicate a real
  persisted status (New → Investigating → Acknowledged → Resolved → False Positive),
  not derived/fake state. Severity (critical/high/medium/low) is computed directly from
  the similarity engine's own score — see `src/services/severity.js`,
  `src/routes/alerts.js`
- **File-signature validation**: checks actual file bytes (magic numbers) against the
  declared type on upload — catches mislabeled/spoofed files. This is content-signature
  validation, explicitly NOT malware scanning (see `src/services/fileSignature.js` and
  the "not built" section below)
- **`/api/datasets/check`**: a storage-free duplicate check endpoint (fingerprint in,
  verdict out, nothing persisted) — this is what the browser extension calls
- **Content-level diffing**: when a non-exact match is found, the worker fetches and
  decrypts the matched file and computes a real diff against the new upload — row-level
  for CSV (added/removed/unchanged row counts, column changes, a preview of the actual
  changed rows), line-level for JSON/text, and an honest "can't line-diff this format"
  fallback for PDFs/images. See `src/services/contentDiff.js` — tested against real CSV
  and JSON fixtures, not just eyeballed
- **Discard-upload flow**: `DELETE /api/datasets/versions/:versionId` — after seeing the
  diff, the uploader (or an admin) can discard their just-uploaded version if the changes
  aren't worth keeping as a separate copy. Time-limited to 30 minutes for non-admins so
  it can't be used to quietly rewrite registry history

## What's implemented (frontend)

Real Vite + React app (`frontend/`), not mockups — builds clean with `vite build`.

- **Login** — JWT auth against the real API
- **Search** — full-text search with domain filter, plus an optional geospatial bounding-box
  filter that hits the real Elasticsearch `geo_shape` query
- **Upload** — metadata form (title, domain, classification, period, spatial bbox), submits
  to the real upload pipeline, polls `/upload/:versionId/status` for the async fingerprint
  result, shows the exact-duplicate short-circuit or the similarity breakdown live
- **Dataset detail** — versions list, the actual pre-download alert modal (the core UX of
  the whole system: "Use existing" vs "Continue anyway"), and a React Flow lineage graph
  rendering duplicate/version/subset/superset/related relationships — each node's detail
  panel now shows the full similarity radar chart, not just a score
- **Alert Center** — filterable list of every detected duplicate (by status/severity),
  backed by the real `alert_reviews` workflow, not mock data
- **Alert Detail** — full investigation view: what happened, why it was detected (radar
  chart + signal table), previous occurrences, a real audit trail scoped to the two
  datasets involved, and status-change actions with notes
- **Dashboard** — bandwidth/storage saved, duplicate downloads prevented, top-duplicated
  datasets and department usage, via Recharts against real aggregate queries, plus a real
  "requires attention" panel and activity timeline sourced from the audit log
- **Audit log page** (admin-only) — one-click live verification of the hash chain, showing
  either "chain intact, N entries verified" or exactly where tampering broke it

**Government classification taxonomy** — `ClassificationBadge` is a distinct component
from the generic status badges, with its own icon language (Unlock/Building/Lock/
ShieldAlert) and an inline hover explanation of what each sensitivity level actually
means and who can access it — not just a recolored generic badge.

**Upload wizard** — rebuilt as 3 steps (file → describe → review) instead of one long
form. Only the title is required to proceed; description, time period, and spatial
bounding box are collapsed under an explicit "optional" toggle, so a first-time user
isn't confronted with every field DDAS is capable of capturing at once. When a near-match
is found, the result screen shows exactly what changed (via `DiffView`) and offers a real
"Keep as new version" vs "Discard this upload" choice — not just an FYI.

**Design system**: ink-navy chrome + cool light workspace, teal for "verified," amber for
duplicate alerts, monospace for hashes/IDs/technical values. The signature visual is now
a **radar chart** of the 5 similarity signals (schema/metadata/temporal/spatial/semantic)
alongside the signal table — used consistently in the download alert, upload result,
lineage graph node panel, and alert detail page, so a match is always explainable, not a
black-box score.

## What's NOT built (roadmap only — say this explicitly if asked)

**Infra:** Apache Iceberg, multi-datacenter Kubernetes/DR, HSM/hardware key management,
**full malware sandboxing** (what's built is content-signature/magic-byte validation —
real, but not an antivirus engine), real government SSO federation. See
`DDAS_Government_Grade_Build_Plan.md` for how these are framed in the pitch deck.

**Frontend (Phase 2 — needs new backend entities first, not built to avoid fabricating
data behind a UI):**
- **Reports engine** — generating/exporting PDF/CSV duplicate/audit/department reports
  on demand
- **Administration** — user/role management, system configuration UI
- **Global cross-entity search (Ctrl+K)** — search only covers datasets today; searching
  users/audit events/reports would need a combined index
- **Notifications** — no push/email notification system exists
- **UX analytics pipeline** — no anonymized event tracking (`dashboard_view`,
  `search_no_result`, etc.) is implemented

## API surface so far

```
POST   /api/auth/register
POST   /api/auth/login

POST   /api/upload                          (multipart file + metadata)
GET    /api/upload/:versionId/status

GET    /api/datasets/search?q=&domain=&department=&minLat=&maxLat=&minLng=&maxLng=
GET    /api/datasets/:id
GET    /api/datasets/:id/relationships
POST   /api/datasets/check                  (storage-free fingerprint check — used by the extension)
POST   /api/datasets/versions/:versionId/download?force=true
POST   /api/datasets/versions/:versionId/reuse
GET    /api/datasets/dashboard/stats
GET    /api/datasets/dashboard/attention      (real "requires attention" feed)
GET    /api/datasets/audit/recent?limit=15    (real activity timeline, own events unless admin)
GET    /api/datasets/audit/verify             (admin only)

GET    /api/alerts?status=&severity=&department=
GET    /api/alerts/summary
GET    /api/alerts/:relationshipId
POST   /api/alerts/:relationshipId/status   (body: { status, notes? })
```

## Scaling demo

The `api` service deliberately has no fixed host port or container name, since both
would collide under `--scale`. To actually see horizontal scaling in action:

```bash
docker compose up -d --build --scale api=3
docker compose up -d nginx
```

Then hit `http://localhost:8080/health` repeatedly (or `watch curl -s -I
http://localhost:8080/health`) and look at the `X-Upstream-Addr` response header — it'll
rotate between the different `api` container IPs, proving requests are actually being
load-balanced, not just theoretically scalable. Nginx force-reresolves the `api` hostname
per-request against Docker's embedded DNS (`127.0.0.11`) specifically so it picks up
replicas added after nginx itself started — see the comments in `nginx/nginx.conf`.

The main frontend does **not** go through nginx by default (it talks to `api:4000`
directly over the internal Docker network) — this is a separate, opt-in demo path.

## CI

`.github/workflows/ci.yml` runs on every push: syntax-checks all backend files and runs
a full `vite build` on the frontend. If you push this to an actual GitHub repo, it'll run
automatically — no extra setup needed.

## Running the frontend

It's wired into `docker-compose.yml` as the `frontend` service — `docker compose up` starts
everything including the UI dev server at `http://localhost:5173`. To run it standalone
against a locally-running backend:

```bash
cd frontend
npm install
npm run dev
```

## Next (not yet built)

- A "Reuse Existing Dataset" access-link flow (currently just logs the reuse event)
- Assigning alerts to a specific user from the Alert Detail page (the `assigned_to`
  column exists and is read, but there's no UI to set it yet — it's set implicitly to
  whoever first changes the status)
- Department filter on the Alert Center (the backend supports `?department=`, the
  frontend filter UI for it isn't wired up yet)
