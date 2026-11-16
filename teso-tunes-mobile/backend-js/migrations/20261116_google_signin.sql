-- TesoHub Music — Google Sign-In identities.
-- Apply in Supabase SQL Editor BEFORE deploying backend routes.
-- The Google immutable subject (sub), not email, identifies each Google account.
CREATE TABLE IF NOT EXISTS tesohub_music.google_identities (
  google_sub TEXT PRIMARY KEY,
  listener_id BIGINT NOT NULL UNIQUE REFERENCES tesohub_music.listeners(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS google_identities_listener_idx
  ON tesohub_music.google_identities(listener_id);
