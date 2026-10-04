-- Migration: lp_image_upload_jobs — background landing-page AI image uploads.
-- The table exists in the Postgres schema and in cod-shared/db/schema.ts but
-- no sqlite migration ever created it. Additive; empty for existing installs.

CREATE TABLE IF NOT EXISTS lp_image_upload_jobs (
  id TEXT PRIMARY KEY,
  landing_page_id TEXT NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  error TEXT,
  image_id TEXT,
  src TEXT,
  position INTEGER,
  width INTEGER,
  height INTEGER,
  alt_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lp_image_upload_jobs_lp ON lp_image_upload_jobs(landing_page_id);
