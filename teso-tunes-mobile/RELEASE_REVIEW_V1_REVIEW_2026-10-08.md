# Release Review V1 - Local Review

Status: IMPLEMENTED LOCALLY, NOT APPROVED FOR DEPLOYMENT.
Branch: `codex/release-review-v1`.
Base: `0d78134d0411ec22469a103e002f0f1cdf763556`.
No production API, database, Storage or real applicant/release mutations were used.

## 1. Architecture and Flow

- Artist UI: `mobile/src/screens/ArtistStudioScreen.js`, `ReleaseUploadScreen.js`.
- API client: `mobile/src/api/musicApi.js` (`getArtistStudioDashboard`,
  `getArtistStudioReleases`, create/update/submit Artist Studio release helpers).
- Artist endpoints: GET `/api/artist-studio/dashboard/`, GET/POST
  `/api/artist-studio/releases/`, PUT `/api/artist-studio/releases/:id/`,
  POST `/api/artist-studio/releases/:id/submit/`.
- Uploads use the existing memory-backed multipart handling, `uploadUrlFor`,
  `uploadFile`, UUID-based object names and `x-upsert:false`.
- Configured audio bucket defaults to private `music-audio`, path
  `songs/audio/<unique-name>`; artwork bucket defaults to `artwork`, path
  `songs/covers/<unique-name>`. Artwork remains under the existing public-media
  policy; V1 does not make artwork private or change bucket configuration.
- Release metadata is in `tesohub_music.releases`, joined to `artists` and
  `listeners`. Publication creates `songs`, linking `source_release_id` back to
  the release and `public_song_id` to the song. Review history uses existing
  `admin_audit_logs`. No new tables or status fields.
- Server flow: `releasePayload` / `assignReleasePayload`,
  `validateReleaseForSubmit`, `submitReleaseForReview`, `serializeRelease`,
  `serializeReleaseReview`, `publishRelease`. `loadDb` / tracked `saveDb` use
  `supabasePersistence.saveChanges` and `applyScopedChanges` transactions.
- Admin GET list/detail: `/admin-api/releases`, `/admin-api/releases/:id`.
- Admin POST decisions: `/admin-api/releases/:id/approve`, `/reject`,
  `/request-changes`. All retain the existing `releases` permission.
- Admin UI stays in `backend-js/public/index.html`; list, detail, decision and
  audio-state handlers are scoped to Release Review.

## 2. Canonical Statuses

Existing: `draft`, `under_review`, `approved`, `rejected`, `scheduled`, `published`.
The normal approval path transitions directly from `under_review` to
`scheduled` (future date) or `published` (today/past). `approved` remains a
recognized legacy/schema status, not a new workflow stage. The UI labels
`under_review` as Needs Review in the filter. Request changes uses `rejected`
plus a reason; artist resubmission returns the same release to `under_review`.

## 3. Ranked Findings

| Severity | Finding | Treatment |
| --- | --- | --- |
| Critical | No new critical public-private audio bypass demonstrated. | Existing P0-A authorization, opaque audio proxy, Range and cookie tests retained. |
| High | Catalog, Studio and some Admin GETs could publish due scheduled releases. Public persistence reads also ran the publisher. | Removed read-triggered publication everywhere; explicit background worker only. |
| High | Approval did not validate both directions of active account/artist ownership. | Handler validation and transactional relationship locks/checks added. |
| High | P0-C scoped status updates did not compare unchanged reviewed metadata/media; a concurrent metadata edit could leave a published song built from an older snapshot. | Release lifecycle transitions compare the full persisted release baseline; conflict rolls back song, release and audit. |
| Medium | Re-entering Release Review reused indefinitely cached results; no title/artist search or dedicated review detail. | Fresh reads, queued forced refresh, focused search and dedicated detail. |
| Medium | Scheduled releases could be approved repeatedly, duplicating review audit events. Published approval retries returned errors. | Terminal approval retry is a read-only success; concurrent approval reconciles to the committed result. P0-C already prevented duplicate committed transaction results. |
| Medium | PostgreSQL DATE conversion through UTC could shift dates by one day on non-UTC hosts. | Preserve the pg calendar date; tests cover Kampala, Los Angeles and UTC. |
| Medium | Studio refresh responses could arrive out of order. | Latest-request guard and blur cleanup; private Studio responses are no-store. |
| Medium | Backend edit/resubmit exists, but Studio cards did not open an editor. | Rejected/changes-requested cards open the existing form, prefilled from fresh account-scoped data; PUT edits/resubmits the same release. |
| High | An unconditional startup publisher could publish historical due releases before inspection. | Exact-value opt-in flag, disabled by default; read-only publication eligibility filters allow pre-enable inspection. |
| Low | Rejection accepted any nonempty string and audio failures had no explicit Retry state. | Minimum 5-character trimmed reason, clear error/Retry and buffering feedback. |

API failures were already distinguishable from empty through the shared loader;
V1 preserves and tests that behavior. No claim is made that every theoretical
race or private-media attack existed in production.

Deletion audit: Release Review has no delete action. Existing permanent song
and artist deletion remains separately Super Admin-only with confirmation.
Artist deletion has existing FK cascade implications for releases; song deletion
can leave an existing release without its public-song link. V1 does not redesign
deletion or auto-republish such inconsistent records. Original uploads are not
deleted on rejection or changes requests.

## 4. Read Routes

Admin list/detail now call plain `loadDb`. The compatibility helper named
`loadDbWithPublishedReleases` now only reads; its old name is retained to limit
unrelated call-site churn. All five implicit persistence publisher calls were
removed from artist/song list/detail and play-count recording. Dashboard,
Applications, health and audio requests do not trigger publication.

## 5. List

All statuses by default, sorted Needs Review first, then latest submission.
Artwork, title, artist, genre/language, status, submitted date and intended date
are visible. Each row has Review only. Filters include all six canonical states.
List/detail responses are no-store, with validated status and optional server
title/artist search. Client search and status work together without rebuilding
the search input while typing. Publication filters include Approved + Scheduled,
Already due (UTC), Future scheduled dates and Eligible if enabled. These combine
with status/search, and Clear filters resets all three. The optional API query is
`publication=approved_scheduled|due|future|eligible`. List/detail include a computed
`publication` object (candidate, timing, eligible, reason). The UI shows title,
artist, release date, status and eligibility/reason, never the environment flag.
This is metadata eligibility, not verification that every media object is readable.
Refresh remains read-only and no-store. Existing `releases` permission is required.

## 6. Detail

Dedicated detail includes existing metadata, artwork, protected audio, rights,
explicit flag, credits, featured artist, language, dates, ownership validity,
account ID/name and filtered release review history. Contact email/phone are
excluded from the Admin review serializer. No general audit-export permission
is exposed. History is derived from existing release-scoped audit entries;
`reviewed_by` is not a persisted release column and is not invented as one.

## 7. Preview

The existing `/api/releases/:id/audio/` proxy and 15-minute HttpOnly audio-only
Admin cookie remain unchanged. The opened detail loads metadata, native controls
play/pause/seek, and state text distinguishes loading, buffering and errors.
Retry renews the existing Admin preview session and reloads the same proxy.
No raw private Storage URL, signed URL or bearer token appears in audio markup.
P0-A tests verify reviewer/owner access, unrelated artist/listener/support
denial, Range/206, expiry and no publication from preview. Browser playback uses
synthetic WAV bytes and a synthetic HttpOnly cookie, not production recordings.

## 8. Approval

Only `under_review` without a conflicting public song can enter approval.
Validate metadata, calendar date, rights and active bidirectional ownership.
The new UI submits `expected_updated_at`; stale detail receives 409 and reloads.
Legacy clients may omit that field, but transaction snapshot guards still apply.
Scoped transactional writes create/link the song (if due), update the release
and append one approval audit. Media paths and source linkage are preserved.
Duplicate UI requests are blocked. Already approved scheduled/published retries
return current state without writes. Concurrent losers reread the committed
approval; competing decisions fail safely with 409, not partial writes.

## 9. Rejection / Changes

Require a trimmed reason of at least 5 characters. Only under-review or scheduled
unpublished releases can be returned; published content cannot be rejected
through this workflow. Release reason/status and audit are updated transactionally.
Artist account and original media remain intact. No public song is created.
Length validation cannot guarantee the human usefulness of a reason.

## 10. Scheduled Publication

`SCHEDULED_PUBLISHER_ENABLED` enables the worker ONLY when its value is exactly
the case-sensitive string `true`. Missing, empty, whitespace, `false`, `TRUE`,
`1`, padded `true` and other malformed values disable it. It is read at startup;
changing it requires a process restart. The value is never sent to clients.

Disabled: server startup works, no interval is registered, no startup publication
is invoked, and a direct worker-function invocation returns before any database
call. Read-only review/inspection never publishes. Manual Admin review remains
available; explicit approval of a due release can still publish through the
existing authorized approval transaction. This switch stops AUTOMATIC publication,
not intentional Admin approval.

Enabled: after server listen, run one background pass, then every 60 seconds.
There is no public scheduler endpoint. Same-process overlap is suppressed;
PostgreSQL row locks and SKIP LOCKED arbitrate independent instances.

The Supabase publisher is a scoped atomic SQL statement: eligible due scheduled
rows are locked, ownership rows share-locked, songs inserted, release links/status
updated, and publication audit inserted. If any part fails, all roll back. Errors
log a credential-free failure message and retry at the next tick.

Dates follow the existing date-only model, with a UTC calendar-day boundary.
Required conditions: prior approval, valid active linkage, rights, metadata,
audio/artwork references, no existing public-song link or source song. Malformed
legacy/inconsistent scheduled rows stay private rather than being guessed into
publication. Normal approval creates no prelinked song for future releases.
No null-date scheduled release auto-publishes. Legacy `approved` rows are not
silently promoted. Automatic publication occurs on enabled startup/worker ticks, never because
someone requested a list/detail/audio. A sleeping/down Render process delays
publication until it runs again; this is not an always-on external scheduler.

## 11. Artist State / Resubmission

Studio retains focus refresh, pull-to-refresh, filters and rejection reasons.
Old requests cannot overwrite a later response or update after blur. Rejected
cards (including Request changes, which uses the existing rejected status) show
Edit & Resubmit. The existing ReleaseUpload form opens with the release ID,
loads the authenticated Studio list, verifies editability, and prefills existing
supported Single metadata. Loading/error/Retry are explicit; unavailable or
no-longer-editable releases do not open an editable form.

Save Changes and Resubmit for Review use the existing PUT endpoint and same ID,
not POST/create. Audio/artwork remain unchanged unless a new file is selected;
optional replacements use existing multipart, unique Storage names and
`x-upsert:false`. Existing private audio is not downloaded to resubmit metadata.
The editor sends `expected_updated_at`; stale saves return 409. A synchronous
ref lock prevents duplicate submissions, including while files are being prepared.
Keyboard avoidance, safe area and scroll reachability are retained. Long edit
actions stack vertically on the existing form; no new screen design system.

Backend PUT/submit require the owning active artist and the submitting listener;
foreign releases return 404. Draft/rejected are the only editable states. On
resubmission, the same row becomes under_review and appears in Needs Review;
old approval/current reason fields are cleared, with prior rejection/change
reason available as additive `last_review_reason` derived from existing audit
history. Studio labels it Previous review. Admin retains the decision history.
No public song is created by editing/resubmitting. Private audio keeps P0-A guards.

## 12. Permissions

Super Admin and Content Admin have release-review access. Moderator and Support
Admin do not gain private release review or audio access. All Admin routes retain
their existing P0-B middleware; invalid configured roles still fail closed.
Artist Studio remains authenticated active-artist-only, with existing ownership
checks and additional active linkage validation at approval/publication.

## 13. Data Integrity

Supabase uses only P0-C scoped writes, never a full snapshot replacement or JSON
fallback. Lifecycle guards compare reviewed fields; approval locks current owner
relationships. Songs, release transition and audit commit or roll back together.
Unrelated likes/follows/playlists/accounts/catalog/applications remain untouched.
Maintenance imports and create-only upload semantics are unchanged. Old explicitly
selected JSON mode remains legacy behavior, not a Supabase failure fallback.

## 14. UI States

Separate loading, genuine empty, filtered empty, HTTP error, permission denied,
detail error and saving states; Retry is explicit. New list reads on re-entry and
Refresh; a refresh during an older read queues one fresh read instead of reusing
that response. Detail responses are token/request scoped. Navigation and selected
filters remain usable. No approve/reject controls on tiny rows.

## 15. Responsive Verification

Chrome/Playwright at 320, 360, 390, 768 and 1440 pixels: list and detail have no
horizontal page overflow; artwork loads, audio fits, action buttons are at least
44px high and reachable. Existing compact Applications navigation styling is
reused for Releases. Screenshots reviewed at phone/desktop sizes; real mobile
browser/native audio controls still warrant physical-device testing.

## 16. Tests

New `release-review.test.js`: actual route handlers, isolated PostgreSQL,
submission/detail/private URL projection, real date round trips, review retries,
independent-connection decision races, rejection/reasons/resubmission, wrong or
changing ownership, stale metadata, read-only browsing, future/due scheduling,
unrelated data preservation, audit rollback, worker versus rejection, Studio
out-of-order response handling and timezone checks.

New `release-review-browser.test.js`: actual Admin HTML with synthetic local API,
fresh list/loading/empty/error/403, focus/search/filters, five viewport sizes,
HttpOnly preview playback/seek/Range, buffering/error/Retry and one-click decisions.
Publication filter combinations and narrow-screen inspection are also exercised;
the read-only browser inspection sends no decision and changes no fixture record.
Shared loader has a new in-flight release-refresh regression. Existing P0-C
publisher tests now invoke the explicit job, with valid approved/owned fixtures;
their concurrency/uniqueness assertions remain. P0-A tests are unchanged.

New `scheduled-publisher.test.js` executes the actual startup/worker code with
missing/invalid/true flags, checking server startup, zero timer/database calls
when disabled, enabled startup/interval, overlap protection and safe error retry.
Actual PostgreSQL tests additionally compare rows before/after disabled calls and
inspection, then enable the worker and confirm only eligible due rows publish once.
Own/foreign/stale editor requests, retained/replaced media, same-ID resubmission,
Needs Review visibility and retained history run against isolated PostgreSQL.

New `mobile/scripts/test-release-editor.cjs` mounts the actual Studio/editor in
Android, iOS and web adapters for reasons/prefill, duplicate guards, failure/retry,
retained and replaced media, editability, keyboard configuration and same-ID PUT.
`verify-release-editor.cjs` runs the exported PWA in Chrome with every API request
intercepted, at five widths. It checks reasons, prefill, scroll reachability in a
shortened viewport, one multipart PUT/no POST on rapid clicks, return to review,
and the previous reason. It does not claim to emulate a physical Android keyboard.

## 17. Validation Results

- Backend/Admin full suite: 173 passed, 0 failed, 0 skipped (including parent tests).
- Listener/mobile regression scripts: 46 passed, 0 failed, 0 skipped.
- Exported PWA editor browser checks: PASS at 320/360/390/768/1440 pixels.
- Backend and inline Admin JavaScript syntax: PASS.
- Diff check and added-diff/new-file secret-pattern scan: PASS.
- Protected P0-A routes/audio, P0-B role/authentication code and P0-C tracked
  server persistence bridge are unchanged against the baseline.
- Android and web production exports: PASS. Source maps confirm the updated
  Artist Studio request guard and edit/resubmit screen are included in both bundles. Output is outside the
  repository under the local temporary `tesohub-release-review-export` directory;
  nothing was uploaded. No APK was built.
- Combined automated totals: 219 passed, 0 failed, 0 skipped across the two suites,
  plus five exported-PWA browser scenarios.
- All database tests use disposable localhost databases; all browser records and
  audio are synthetic. No production credential required or used.

## 18. Files

- `backend-js/server.js`
- `backend-js/supabasePersistence.js`
- `backend-js/scopedChanges.js`
- `backend-js/public/index.html`
- `backend-js/tests/admin-loading.test.js`
- `backend-js/tests/admin-permissions.test.js` (existing harness helper stubs only)
- `backend-js/tests/scoped-writes.test.js`
- `backend-js/tests/scoped-writes-postgres.test.js`
- `backend-js/tests/release-review.test.js` (new)
- `backend-js/tests/release-review-browser.test.js` (new)
- `backend-js/tests/scheduled-publisher.test.js` (new)
- `mobile/src/screens/ArtistStudioScreen.js`
- `mobile/src/screens/ReleaseUploadScreen.js`
- `mobile/scripts/test-release-editor.cjs` (new)
- `mobile/scripts/verify-release-editor.cjs` (new)
- `RELEASE_REVIEW_V1_REVIEW_2026-10-08.md` (this report)

## 19-20. Schema / Production Data

Schema changes: NO. Production data changes: NO. Existing migration SQL was
executed only to build disposable local test databases. No migration file changed.

## 21. Deployment Risk

First-deploy automatic-publication risk is reduced by the default-off switch.
Overall release risk remains moderate because review and publication affect
catalog visibility. A later enablement can immediately publish ALL eligible due
scheduled rows, including historical ones. The flag is a process setting, not a
transaction cancellation: disabling after a worker has started cannot undo a
publication already committed or guarantee cancellation of an in-flight pass.

Safe deployment sequence (NOT executed):
1. Review/approve this local release and its exact diff/tests. Fetch master and
   preserve newer work before preparing any approved release commit.
2. Explicitly configure `SCHEDULED_PUBLISHER_ENABLED=false` in the production
   Render environment for every backend instance. Keep it disabled on first deploy.
3. Deploy only the approved release. Verify health/Supabase, Admin authentication,
   P0-A playback/private protection and P0-B permissions without mutations.
4. Open Release Review, Clear filters, select Approved + Scheduled, then Already
   due and Eligible if enabled. Inspect titles, artists, dates, status, eligibility
   reasons and active linkage. Inspect Future dates and any legacy/ineligible
   candidates separately. Refresh and verify inspection leaves statuses unchanged.
   Do not click Approve as part of this read-only inspection.
5. Report the complete due/eligible inventory for explicit owner approval. Resolve
   anomalies only under a separate authorized data-correction plan; no bulk edits,
   automatic promotion of legacy approved rows or migration reruns.
6. Verify Studio edit/resubmit using an approved disposable fixture, then deliver
   the JS-only mobile/PWA changes separately if authorized. No new APK required.
7. Only after explicit enablement approval, set the exact string `true` and restart
   the backend. Observe first pass, audit records and later 60-second ticks;
   verify one song per release and future releases staying private.
8. If problems occur, disable the flag and restart all instances, then fix forward.
   Preserve P0-A/B/C and side-effect-free reads; do not roll back to read-triggered
   publication or unprotected private audio. Committed publications are not undone
   by disabling the worker and require separately authorized remediation.

## 22. Limitations

- No production or physical-device verification in this local task.
- Scheduling is date-only and process-dependent, not precise time-of-day/SLA.
- Inconsistent legacy scheduled records are held private for explicit investigation.
- List reads still load the existing database DTO; no pagination/realtime redesign.
- Upload object existence/content decoding is checked by preview, not a new media
  scanner. Failed SQL saves can leave existing-style unreferenced private uploads.
- Full metadata versions are not retained; existing audit history contains decisions
  and reasons. No schema was added to create versioned submission snapshots.

## 23. Release Boundary

NOTHING DEPLOYED. No push, OTA, PWA release, APK build, native configuration change,
schema migration, production record mutation or approval/rejection of real music.
Original working files and other worktrees preserved. Stop for review/approval.
