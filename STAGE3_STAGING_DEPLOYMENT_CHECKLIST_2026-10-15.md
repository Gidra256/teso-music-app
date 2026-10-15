# TesoHub Music Stage 3 Staging Deployment Checklist

This checklist is for the staging environment only. It does not authorize a
production deployment, a production database connection, or automatic song
removal.

## 1. Source and Render service

- [ ] Confirm Git branch is `staging` and contains the reviewed staging commit.
- [ ] Confirm no unreviewed local files are required by the deployment.
- [ ] Create or select Render service `tesohub-music-staging-api`.
- [ ] Set branch to `staging`.
- [ ] Set root directory to `teso-tunes-mobile/backend-js`.
- [ ] Set build command to `npm install`.
- [ ] Set start command to `npm start`.
- [ ] Set health check path to `/healthz`.
- [ ] Keep Render Auto-Deploy disabled until staging sign-off.
- [ ] Do not sync the repository `render.yaml` to this service. That Blueprint
      currently names the production API and PWA services.

## 2. Staging-only environment boundary

- [ ] Configure `PERSISTENCE_BACKEND=supabase`.
- [ ] Configure `DATABASE_URL` for `tesohub-music-staging` only.
- [ ] Configure `SUPABASE_URL` for `tesohub-music-staging` only.
- [ ] Configure one server credential using `SUPABASE_SECRET_KEY` or the legacy
      `SUPABASE_SERVICE_ROLE_KEY`; never place it in client or Expo variables.
- [ ] Confirm `DATABASE_SSL_REJECT_UNAUTHORIZED` matches the tested Supabase
      pooler connection requirements.
- [ ] Configure the existing staging bucket names where they differ from the
      defaults: `SUPABASE_AUDIO_BUCKET`, `SUPABASE_ARTWORK_BUCKET`,
      `SUPABASE_AVATAR_BUCKET`, and `SUPABASE_SUPPORT_ATTACHMENTS_BUCKET`.
- [ ] Configure `PUBLIC_BASE_URL` and `PUBLIC_API_BASE_URL` to the staging API
      origin, not `api.tesohubmusic.com`.
- [ ] Configure `PUBLIC_SHARE_BASE_URL` and `PUBLIC_MUSIC_WEB_URL` deliberately.
      Do not point a staging web client at production by accident.
- [ ] Configure `CORS_ALLOWED_ORIGINS` with exact staging web origins if a
      staging PWA is used. Do not use `*` with authenticated requests.
- [ ] Configure the existing Admin recovery variables and an exact supported
      `ADMIN_ROLE` without copying production credentials.
- [ ] Verify no production `DATABASE_URL`, Supabase project URL, secret, Admin
      credential, or storage bucket is present in the staging service.

## 3. Safety switches

- [ ] Set `SONG_REMOVAL_WORKER_ENABLED=false`.
- [ ] Set `SCHEDULED_PUBLISHER_ENABLED=false`.
- [ ] Confirm Artist Agreement enforcement remains `off` in platform settings.
- [ ] Keep automatic deployments disabled.
- [ ] Do not run migrations from application startup.

## 4. Database readiness

- [ ] Confirm migrations 001, 004, 005, 006, 007, 008, and hardened 009 are
      present in the staging database migration record/operator log.
- [ ] Read-only verify `tesohub_music.song_removal_requests` and
      `tesohub_music.song_removal_events` exist.
- [ ] Read-only verify `cancellation_reason` exists and the cancellation reason
      constraint is validated.
- [ ] Read-only verify RLS is enabled on both removal tables.
- [ ] Read-only verify PUBLIC, `anon`, `authenticated`, and `service_role` have
      no usable direct table or sequence privileges.
- [ ] Confirm the backend database owner retains required access.
- [ ] Do not rerun destructive tests against staging or production data.

## 5. First staging deploy

- [ ] Deploy manually from the reviewed `staging` revision.
- [ ] Confirm startup has no migration, storage, authentication, or worker
      errors.
- [ ] Confirm `/healthz` returns HTTP 200 and `persistence_backend=supabase`.
- [ ] Confirm logs do not show either scheduled worker starting.
- [ ] Confirm Admin shell loads without making any destructive change.

## 6. Isolated Stage 3 smoke test

Use disposable staging accounts, artists, songs, and releases only.

- [ ] Create or select one disposable approved active Artist account.
- [ ] Confirm another Artist cannot access or remove that Artist's song.
- [ ] Submit a removal request with fewer than 10 reason characters; expect 400.
- [ ] Submit a valid removal request; expect one scheduled request and exactly
      a 30-day deadline.
- [ ] Repeat the request; expect an idempotent conflict, not a duplicate row.
- [ ] Confirm the request and history are visible only to the owning Artist and
      authorized Admin roles.
- [ ] Attempt cancellation with fewer than 10 characters; expect 400.
- [ ] Cancel with a valid reason; confirm status, reason, timestamp, and history.
- [ ] Confirm cancellation after the deadline is rejected.
- [ ] Confirm Admin removal requires a reason and records an Admin audit event.
- [ ] Confirm a removed/private song cannot stream through public, storage,
      `/uploads`, or `/media` routes.
- [ ] Confirm a published public song still supports HTTP Range 206 and seeking.
- [ ] Keep the automatic removal worker disabled throughout these checks.

## 7. Agreement and identity regression

- [ ] New Artist application can read the current Agreement and record explicit
      acceptance using the authenticated account and server timestamp.
- [ ] Agreement version/hash evidence is immutable and duplicate acceptance is
      rejected.
- [ ] Agreement enforcement remains off and legacy approved Artists stay active.
- [ ] Duplicate-name warnings are advisory only.
- [ ] Verification status remains separate from application approval.
- [ ] Only authorized Admin roles can issue/complete social challenges or record
      verification decisions.
- [ ] Challenge secrets are one-time and are not exposed in public APIs.
- [ ] Existing Artist approval, Artist Studio, upload, and Release Review flows
      still work.

## 8. Client verification

- [ ] Build the staging client with an explicit staging API base. Do not rely on
      the repository's production web-export defaults.
- [ ] Android: request and cancel removal, view history, verify keyboard-aware
      reason dialogs, and confirm playback/navigation remain stable.
- [ ] PWA: repeat the same flows and confirm CORS uses the exact staging origin.
- [ ] Confirm login, refresh, loading, error, and retry states remain usable.
- [ ] Confirm no backend secret appears in either client bundle.

## 9. Exit criteria

- [ ] Record the exact staging Git SHA and Render deploy identifier.
- [ ] Record all smoke-test fixture IDs and delete only disposable fixtures after
      validation through supported application/Admin workflows.
- [ ] Review Render logs for unexpected 401/403/409/500 responses.
- [ ] Obtain approval before enabling the removal worker, auto-deploy, or any
      production rollout.
