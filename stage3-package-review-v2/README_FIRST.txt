TESOHUB MUSIC — STAGE 3 TESTED INTEGRATION PREVIEW v2
Prepared 2026-10-14 — LOCAL REVIEW ONLY

IMPORTANT: DO NOT INSTALL, OVERWRITE PROJECT FILES, APPLY SQL OR DEPLOY YET.
No original project files or live databases have been changed.

FIXED FROM v1: REAL MOBILE FILE LOCATIONS (CONFIRMED FROM USER'S FULL MOBILE ZIP)
  mobile/src/screens/ArtistStudioScreen.js
  mobile/src/api/musicApi.js
The previous preview incorrectly used mobile/screens and mobile/api.

BACKEND AND DATABASE:
  backend-js/server.js
  backend-js/supabasePersistence.js
  backend-js/scopedChanges.js
  backend-js/songRemovalStore.js (new)
  backend-js/public/index.html
  backend-js/migrations/009_song_removal_requests.sql (new)

TESTS:
  backend-js/tests/song-removal-store.test.js (new)
  backend-js/tests/song-removal-persistence.test.js (new)
  backend-js/tests/admin-permissions.test.js (updated test stub for reconciliation helper)
  backend-js/tests/release-review.test.js (updated screen test stub for added hooks)
  backend-js/tests/snapshot-loading.test.js (updated fixture for existing 007/008 agreement snapshots)
  checks/verify_mobile_removal_api.mjs (mock network only, corrected import path)

VALIDATION PERFORMED IN A TEMPORARY PROJECT COPY (NO PROD SERVICES):
  Backend test suite, except two environment-dependent files: 130 tests;
  116 passed; 0 failed; 14 skipped (PostgreSQL/Playwright integration).
  2 files excluded from that run: admin-ui-density.test.js requires Playwright;
  custom-domain-cutover.test.js requires files outside supplied archives.
  Mock mobile API wrappers: 4 tests passed.
  Backend JavaScript syntax: passed.
  React Native JSX/API parsed with Babel: passed.
  Expo SDK55 web static export: succeeded (691 modules).
  Expo SDK55 Android/Hermes bundle export: succeeded (1003 modules).

NOT VERIFIED YET:
  Migration 009 against disposable PostgreSQL or Supabase database.
  Authenticated end-to-end request/cancel/timed-removal with real database.
  Device UI interaction, permissions, background worker timing, rollback.
  Two environment-dependent existing test files.

PRODUCT RULES:
  30-day notices and cancellation before due date.
  Administrator immediate take-down remains possible for moderation/copyright.
  New removal worker remains OFF by default unless explicitly enabled.
  Apply migration 009 BEFORE starting this version of server with Supabase.

PRESERVATION AND SECURITY:
  Migrations 007/008 not modified or included; Artist Agreement and Identity
  Verification logic from the uploaded project is preserved.
  No .env, credentials, node_modules or user's log files included.
  No git commit, push, deploy or production database migrations performed.
  This is a preview package, not a launch-ready release.
