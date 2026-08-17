-- Migration 002: alert review workflow
-- Safe to run against an already-running DDAS database (idempotent).
-- Apply with:
--   docker compose exec -T postgres psql -U ddas -d ddas < backend/src/db/migrations/002_alert_reviews.sql

CREATE TABLE IF NOT EXISTS alert_reviews (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    relationship_id UUID NOT NULL UNIQUE REFERENCES version_relationships(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'new',
    assigned_to     UUID REFERENCES users(id),
    notes           TEXT,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_reviews_status ON alert_reviews(status);
