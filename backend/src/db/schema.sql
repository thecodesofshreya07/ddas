-- DDAS core schema
-- Design principle (from the project blueprint): separate the logical dataset
-- from its physical versions/files, keep Postgres as the single source of truth,
-- and make the audit log tamper-evident via hash chaining.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Users & departments (simplified — no external IdP for the hackathon build)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    department      VARCHAR(100) NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'user', -- user | department_admin | admin
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Access policies (ABAC) — evaluated by the policy middleware on every
-- sensitive request. Kept data-driven so rules can change without redeploys.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_policies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role            VARCHAR(50) NOT NULL,       -- matches users.role, or '*' for any
    department      VARCHAR(100),               -- NULL = any department
    classification  VARCHAR(50) NOT NULL,       -- public | internal | restricted | confidential
    action          VARCHAR(20) NOT NULL,       -- view | download | reuse
    effect          VARCHAR(10) NOT NULL DEFAULT 'allow', -- allow | deny
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Logical dataset — the thing a user searches for and reasons about.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS datasets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(500) NOT NULL,
    description         TEXT,
    domain              VARCHAR(100),          -- e.g. Meteorology, GIS, Census
    owner_department    VARCHAR(100) NOT NULL,
    classification      VARCHAR(50) NOT NULL DEFAULT 'internal',
    status              VARCHAR(20) NOT NULL DEFAULT 'active', -- active | archived | deleted
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Physical version of a dataset — this is what actually gets hashed,
-- fingerprinted and compared. A dataset can have many versions; a version
-- can be flagged as duplicate/related to another version.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dataset_versions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_id          UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    version_num         INT NOT NULL DEFAULT 1,
    original_filename   VARCHAR(500),
    format              VARCHAR(20),            -- csv | json | parquet | pdf | image | other
    size_bytes          BIGINT NOT NULL,
    sha256              CHAR(64) NOT NULL,       -- exact-duplicate fingerprint
    storage_key         VARCHAR(500) NOT NULL,   -- MinIO object key
    period_start        DATE,
    period_end          DATE,
    spatial_min_lat     DOUBLE PRECISION,
    spatial_max_lat     DOUBLE PRECISION,
    spatial_min_lng     DOUBLE PRECISION,
    spatial_max_lng     DOUBLE PRECISION,
    spatial_region_name VARCHAR(255),
    schema_fingerprint  JSONB,                   -- {columns, types, row_count, stats...}
    uploaded_by         UUID NOT NULL REFERENCES users(id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sha256)                               -- DB-enforced exact-duplicate uniqueness
);

CREATE INDEX IF NOT EXISTS idx_versions_dataset ON dataset_versions(dataset_id);
CREATE INDEX IF NOT EXISTS idx_versions_period ON dataset_versions(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_versions_size ON dataset_versions(size_bytes);
CREATE INDEX IF NOT EXISTS idx_datasets_domain ON datasets(domain);
CREATE INDEX IF NOT EXISTS idx_datasets_classification ON datasets(classification);

-- ---------------------------------------------------------------------------
-- Relationships between versions: duplicate / new_version / subset / superset
-- / related — populated by the duplicate-detection engine.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS version_relationships (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version_a_id        UUID NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
    version_b_id        UUID NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
    relationship_type   VARCHAR(20) NOT NULL,   -- exact_duplicate | new_version | subset | superset | related
    similarity_score    NUMERIC(5,2) NOT NULL,  -- 0.00 - 100.00
    score_breakdown     JSONB,                  -- {content: .., metadata: .., temporal: .., spatial: .., schema: ..}
    content_diff        JSONB,                  -- row/line-level diff vs the matched version, when computable
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_relationships_a ON version_relationships(version_a_id);
CREATE INDEX IF NOT EXISTS idx_relationships_b ON version_relationships(version_b_id);

-- ---------------------------------------------------------------------------
-- Download events — what actually happened when a user hit "download"
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS downloads (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_version_id  UUID NOT NULL REFERENCES dataset_versions(id),
    user_id             UUID NOT NULL REFERENCES users(id),
    was_alerted         BOOLEAN NOT NULL DEFAULT false,
    action_taken        VARCHAR(20),            -- used_existing | continued_anyway | first_download
    bytes_saved         BIGINT NOT NULL DEFAULT 0,
    downloaded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_downloads_version ON downloads(dataset_version_id);
CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id);

-- ---------------------------------------------------------------------------
-- Alert review workflow. A "duplicate detected" event (version_relationships
-- row) is a fact; this table is the human workflow layered on top of it —
-- New -> Investigating -> Acknowledged -> Resolved / False Positive. One
-- review row per relationship (a relationship without a row is implicitly
-- "new" — nobody has looked at it yet).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_reviews (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    relationship_id UUID NOT NULL UNIQUE REFERENCES version_relationships(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'new', -- new | investigating | acknowledged | resolved | false_positive
    assigned_to     UUID REFERENCES users(id),
    notes           TEXT,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_reviews_status ON alert_reviews(status);

-- ---------------------------------------------------------------------------
-- Immutable, hash-chained audit log.
-- Every sensitive action appends a row whose `this_hash` = sha256(prev_hash
-- + canonical JSON of the event). Tampering with any historical row breaks
-- every hash after it, which is verifiable by walking the chain.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(50) NOT NULL,   -- LOGIN | UPLOAD | DUPLICATE_DETECTED | DOWNLOAD_ALLOWED | DOWNLOAD_DENIED | POLICY_CHANGE | ...
    actor_id        UUID REFERENCES users(id),
    resource_type   VARCHAR(50),
    resource_id     UUID,
    details         JSONB,
    prev_hash       CHAR(64) NOT NULL,
    this_hash       CHAR(64) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);

-- Genesis row so every real event has a prev_hash to chain from.
INSERT INTO audit_log (event_type, details, prev_hash, this_hash)
SELECT 'GENESIS', '{}'::jsonb, repeat('0', 64), encode(sha256('genesis'::bytea), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM audit_log);

-- ---------------------------------------------------------------------------
-- Seed a minimal set of default ABAC policies.
-- Deny-by-default for restricted/confidential data; explicit allows below.
-- ---------------------------------------------------------------------------
INSERT INTO access_policies (role, department, classification, action, effect)
SELECT * FROM (VALUES
    ('admin',            NULL, 'public',       'view',     'allow'),
    ('admin',            NULL, 'internal',     'view',     'allow'),
    ('admin',            NULL, 'restricted',    'view',    'allow'),
    ('admin',            NULL, 'confidential',  'view',    'allow'),
    ('user',             NULL, 'public',       'view',     'allow'),
    ('user',             NULL, 'internal',     'view',     'allow'),
    ('user',             NULL, 'restricted',    'view',    'deny'),
    ('user',             NULL, 'confidential',  'view',    'deny'),
    ('department_admin', NULL, 'public',       'view',     'allow'),
    ('department_admin', NULL, 'internal',     'view',     'allow'),
    ('department_admin', NULL, 'restricted',    'view',    'allow')
) AS v(role, department, classification, action, effect)
WHERE NOT EXISTS (SELECT 1 FROM access_policies);
