# TesoHub Music Supabase Migration Runbook

This migration keeps the existing Render API, Android app, PWA, Admin Console, and Artist Studio. Supabase becomes the durable persistence layer for database records and media.

## Current Persistence Audit

- Active backend: Node/Express in `backend-js/server.js`.
- Legacy backend: Django/SQLite in `backend/`, retained as old source material.
- Current JSON database: `backend-js/data/db.json`, or `STORAGE_DIR/data/db.json` on Render.
- Current uploads: `backend-js/uploads`, or `STORAGE_DIR/uploads` on Render.
- Legacy media path still served: `backend/media` via `/media`.
- Local backup created before migration work: `backups/pre-supabase-20260928-192414`.

Local source counts from `backend-js/data/db.json`:

| Type | Count |
| --- | ---: |
| artists | 15 |
| songs | 43 |
| listeners | 0 |
| auth tokens | 0 |
| song likes | 0 |
| artist follows | 5 |
| playlists | 0 |
| playlist songs | 0 |
| artist applications | 0 |
| releases | 0 |
| reports | 0 |
| admin audit logs | 0 |

Live Render read-only inventory on 2026-09-28:

| Type | Count |
| --- | ---: |
| users/listeners | 2 |
| artists | 15 |
| songs | 43 |
| public artists | 15 |
| public songs | 43 |
| artist applications | 0 |
| releases | 0 |
| reports | 0 |
| genres | 14 |
| admin audit logs | 60 |
| derived song likes | 1 |
| derived artist follows | 0 |

The live Admin Platform Health endpoint still reports `json-file` and `local-uploads-folder`, so production is not yet cut over.

## Files Added

- `migrations/001_supabase_initial.sql`
- `scripts/export-render-persistence.js`
- `scripts/migrate-json-to-supabase.js`
- `scripts/validate-supabase-migration.js`

## Required Environment Variables

Set these only on the backend/server side. Never place secret keys in Expo public variables.

```text
DATABASE_URL=postgresql://...
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=...
SUPABASE_AUDIO_BUCKET=music-audio
SUPABASE_ARTWORK_BUCKET=artwork
SUPABASE_AVATAR_BUCKET=avatars
```

For exporting live Render data:

```text
RENDER_BASE_URL=https://teso-music-app.onrender.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...
INCLUDE_SENSITIVE_HASHES=true
```

## Safe Migration Order

1. Deploy the backend containing `/admin-api/persistence-export`.
2. Export live Render JSON:

   ```powershell
   $env:ADMIN_PASSWORD="..."
   $env:INCLUDE_SENSITIVE_HASHES="true"
   npm run export:render
   ```

3. Create the Supabase schema by running `migrations/001_supabase_initial.sql`.
4. Run a dry migration:

   ```powershell
   $env:DRY_RUN="1"
   $env:LEGACY_DB_PATH="C:\path\to\render-export\db.json"
   npm run migrate:supabase
   ```

5. Run the real migration with `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` set.
6. Validate counts and media:

   ```powershell
   $env:VALIDATE_STORAGE="1"
   npm run validate:supabase
   ```

7. Only after validation, switch backend reads/writes from JSON/local uploads to Supabase.
8. Restart/redeploy Render twice and verify data persists.

## Storage Strategy

- `music-audio`: private. Store object paths in PostgreSQL. Backend must issue short-lived playback URLs for playable published songs only.
- `artwork`: public. Store object paths for song/release artwork.
- `avatars`: public. Store object paths for artist/user profile images.

Do not persist signed URLs in the database.

## Demo/Fallback Records

Dry-run found 57 `picsum.photos` artwork/photo references. These are treated as suspected demo/fallback media and are not uploaded to Supabase Storage by the migration utility. They remain recorded as legacy values for review.

## Rollback

Until cutover is explicitly completed:

- Keep using the existing Render API and JSON/local upload persistence.
- Keep `backups/pre-supabase-*` read-only.
- Keep any `backups/render-export-*` folders private because sensitive exports can contain account/session hashes.
- If validation fails, do not switch production environment variables and do not remove Render disk data.

After cutover, rollback means pointing the backend back to the old JSON mode and restoring the backed-up `db.json` and `uploads` folder to `STORAGE_DIR`.
