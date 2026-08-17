-- Migration 003: content-level diff storage
-- Safe to run against an already-running DDAS database (idempotent).
-- Apply with:
--   docker compose exec -T postgres psql -U ddas -d ddas < backend/src/db/migrations/003_content_diff.sql

ALTER TABLE version_relationships ADD COLUMN IF NOT EXISTS content_diff JSONB;
