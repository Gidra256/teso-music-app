# P0-A: Private Audio Access Control

Status: implemented locally, tested, NOT deployed. Awaiting deployment approval.
Date: 7 October 2026. Baseline commit: `7e56778f5525055d396caf989c3a78c622cb16be`.

Only P0-A was implemented. No Admin redesign, P0-B role/export/migration hardening, or P0-C snapshot-write changes. No production HTTP audio probes, private recordings, database writes, approvals, migrations, or deployments were used for these tests.

## 1. Audio Route Inventory and Previous Behavior

| Route / surface | Identifier | Previous authentication / DB checks | Storage lookup / Range | Previous unpublished exposure |
|---|---|---|---|---|
| `GET/HEAD /api/storage/:bucket/*` | Bucket plus object path | No caller authentication, publication, ownership or review-permission checks | Server Storage credentials fetched arbitrary allowed-bucket path; forwarded Range and 206 headers | Yes, for a known audio object path, even with a private bucket |
| `GET/HEAD /uploads/*` | Local relative filename | Express static serving, no record lookup or authorization | Render/local filesystem, Express Range handling | Yes if a private recording remained in that directory |
| `GET/HEAD /media/*` | Legacy relative filename | Express static serving, no record lookup or authorization | Legacy Django media directory, Express Range handling | Yes if the file was present |
| Public/Admin/Artist Studio song and release JSON | Song/release IDs | Endpoint-specific authorization; public song predicates excluded hidden/removed rather than requiring published | Returned raw audio_file URLs, including storage-object paths or legacy external values | Could reveal an unprotected proxy URL; legacy signed URLs could pass through if stored |
| `/api/support/tickets/:id/attachments/:kind/:attachmentId` and `/admin-api/support/tickets/:id/attachments/:kind/:attachmentId` | Owned ticket plus attachment | Existing ownership or support:view checks | Dedicated private Support bucket through server streaming helper | No new bypass found in this task; supported types are images/PDF/text, not a music preview endpoint |
| `/app-assets/*` and `/admin/*` | Packaged asset path | Public static assets | Filesystem | No artist-uploaded audio was found in these directories. Admin public directory contains index.html only. |
| Public share routes (`/song/:id`, `/s/:id`, artist/playlist redirects) | Public entity ID | Existing shareability checks | Metadata/redirects, not recording bytes | Not an independent audio streaming route; metadata rendering omits the audio URL |

## 2. Authorization Model Implemented

The existing object proxy now authorizes audio before Storage access. Two record-based routes provide opaque URLs without exposing storage paths:
- `GET/HEAD /api/songs/:id/audio/`
- `GET/HEAD /api/releases/:id/audio/`

One parameterized, read-only PostgreSQL query resolves the target, song/release status, associated artist, authenticated account relationship, and bucket privacy. There is no whole-database snapshot, session last-active update, auto-publication call, signed Storage URL generation, or fallback to local files in this path.

Invalid IDs, nonexistent objects, unauthorized accounts and unavailable private media return the same `404 {"detail":"Media not found."}`. Invalid IDs/path syntax are rejected before querying. Denied requests do not fetch Storage. Existing identity endpoints retain their established 401/403 behavior.

## 3. Published Content

Guest/listener access requires a song with status exactly `published` and an active associated artist. A source release, if linked, must be published and reference that public song. A release URL is public only when the release is published and its linked published song references the same audio.

Public song listing, single-song lookup and playlist-song reads now use explicit published checks, including source-release publication. JSON-mode public song checks match the same rule. No release is made public merely because its scheduled date has passed inside an audio request.

Existing public `/api/storage/music-audio/...` URLs remain supported after authorization, preserving cached Android/PWA metadata. New response fields retain the `audio_file` contract but point at `/api/songs/<id>/audio/`. Already-public third-party HTTPS audio without embedded credentials/query tokens can redirect to its existing provider; its Range behavior remains provider-dependent.

An object already referenced by another legitimately public song is public audio. A private duplicate reference cannot make the already-public bytes secret. Hiding one of several public references is not object-wide revocation. Previously downloaded bytes or pre-existing browser caches cannot be recalled.

## 4. Artist-Owned Private Previews

Artist authentication uses the existing bearer session token hash. PostgreSQL resolves the account's current role, active status and artist_id. The target release's artist_id must match that server-side relationship, and the artist must be active.

No client-supplied artist/user ID grants access. Listener, artist_pending, suspended accounts, suspended artists, revoked/invalid tokens and a different artist are denied. Artist A cannot obtain Artist B's private audio by changing a release ID or object path.

An owner may preview their own release in the existing canonical states: draft, under_review, rejected, approved, scheduled, published. Published release status alone does not make a hidden linked song public, but the owning artist may still privately preview it.

The current Artist Studio release list has no private Play control. This task does not add one. Its API now provides a guarded preview URL; an authenticated client preview must send its existing bearer header. No listener mobile/PWA code change is needed for public playback.

## 5. Admin and Reviewer Previews

Existing permissions suffice; no role or permission names were added:
- `releases`: private release previews. Current content_admin and super_admin qualify.
- `catalog`: private catalog-song previews. Current moderator, content_admin and super_admin qualify for that resource.
- support_admin: neither private release nor private catalog preview.
- moderator: catalog preview only; no release preview through a release-only reference.

The server evaluates these permissions on every request. A generic Admin token alone is not sufficient. Existing broader authorization issues documented under P0-B remain unchanged and must still be addressed separately.

HTML audio elements cannot set a bearer header. To preserve the existing Admin audio controls, successful authorized `/admin-api/me` responses issue an audio-only HMAC-authenticated cookie:
- 15-minute lifetime; renewed every five minutes while the Admin page is visible and when it becomes visible again.
- HttpOnly, SameSite=Strict, path=/api/, Secure on HTTPS.
- Contains an expiry and signature, not the Admin token, Storage credential or object path.
- Accepted ONLY by the audio authorization resolver, never by ordinary Admin or listener APIs.
- Current server-side permissions still apply; explicit bearer credentials take precedence over the cookie; cross-site browser preview requests are rejected.
- Admin logout calls `DELETE /admin-api/audio-preview-session` to clear the cookie before clearing local login state.

No signed Supabase object URLs are generated. This is a short-lived application audio credential, not a public Storage link. If logout cannot reach the backend, the cookie remains bounded by its 15-minute expiry; global token/session redesign remains P0-B.

## 6. Canonical Status Policy

| Existing state | Guest / ordinary listener | Owning active artist | Authorized reviewer |
|---|---|---|---|
| Release draft | Deny | Allow own preview | releases permission |
| Release under_review | Deny | Allow own preview | releases permission |
| Release rejected | Deny | Allow own preview | releases permission |
| Release approved | Deny until actual publication | Allow own preview | releases permission |
| Release scheduled | Deny, even with a past due date | Allow own preview | releases permission |
| Release published | Allow only if linked published song exposes the same audio | Allow own preview | releases permission |
| Song published | Allow only with active artist and valid published source-release relationship | Public access | Public access |
| Song hidden/removed/under_review | Deny | No independent catalog privilege; use legitimately owned release preview | catalog permission |

There is no canonical `unpublished` status in the current song/release enums. Existing hidden/removed states and non-published release states provide that behavior. Unknown states fail closed. No status names were invented.

## 7. Storage and Privacy Findings

- The existing migration defines music-audio as private. No bucket/schema changes were made.
- Every audio lookup additionally requires the configured bucket's `storage.buckets.public` value to be false. If it becomes public, the backend proxy fails closed. This cannot make an accidentally public bucket private or revoke direct vendor links; fixing such a production configuration would require a separate authorized action.
- Actual live bucket metadata was not read: no production privileged credentials were loaded for this task. A read-only production bucket/privacy check remains a pre-deployment gate.
- Storage service credentials remain server-side. The proxy does not forward upstream Location responses; Storage redirects are refused to avoid credential forwarding.
- Public/listener, Admin and Studio audio serializers return backend record URLs instead of raw private/signed Storage URLs.
- Legacy signed Supabase audio values, if present, are resolved server-side to their object path. The old signature is not sent to the client or reused to fetch the object.
- New Admin audio URL input normalizes configured Supabase URLs to unsigned backend object references before persistence, and rejects credential-bearing or query-token external URLs. No catalog rows were changed during this task.
- Private audio pointing to unsupported external/local legacy storage fails closed in Supabase mode. Do not claim such content is migrated without an inventory.
- Credentialed media has private/no-store caching and Vary: Authorization, Cookie. Missing-media errors are generic, without bucket/object/uploader details, upstream bodies or stack traces.
- The intentionally raw persistence-export/migration surfaces remain P0-B and were not changed or called; this report does not claim those operational responses were redesigned.

## 8. Local Files and Rollback Data

Supabase mode now refuses `/uploads/*` and `/media/*`, rather than exposing an alternate public path around Storage authorization. No files were deleted, moved or modified. This preserves old persistence data on disk for a controlled rollback without exposing it over HTTP.

In explicit JSON development/rollback mode, local audio requires matching database records and the same access policy. Unreferenced files are denied. Referenced artwork remains available. Files are served within checked roots using Express sendFile with Range support. This is not an automatic Supabase-to-JSON fallback.

## 9. Files Changed

Application files:
- `backend-js/audioAccess.js` (new): policy helpers, validation, safe media URL handling, scoped preview-cookie signing/verification.
- `backend-js/server.js`: guarded routes, legacy-file gate, account/reviewer resolution, opaque audio serializers, cookie grant/clear, strict JSON publication checks and safe audio URL input.
- `backend-js/supabasePersistence.js`: targeted read-only authorization query, private-bucket check, protected streaming, published catalog filters, test dependency injection hooks.
- `backend-js/public/index.html`: preview-cookie renewal and logout cleanup only; no layout/design changes.

Tests:
- `backend-js/tests/audio-access.test.js` (new): fixture HTTP security/range/privacy tests.
- `backend-js/tests/audio-postgres.test.js` (new): actual PostgreSQL SQL execution against isolated in-memory fixtures.
- `backend-js/tests/admin-loading.test.js`: timer stub for the existing isolated Admin harness.

Report: this file. The pre-existing modification to `backend-js/scripts/apply-supabase-schema.js` was NOT changed by this work. No dependency manifest, lockfile, migration or native configuration was edited. The optional PGlite test engine was installed only in a temporary tools directory outside the repository, following its [official setup documentation](https://pglite.dev/docs/).

## 10. Tests and Results

Final backend regression run: **46 passed, 0 failed, 0 skipped** with the isolated PostgreSQL test engine enabled.

Requested security cases:
- A guest -> published: PASS.
- B listener -> published: PASS.
- C guest -> unpublished release: DENIED, PASS.
- D listener -> unpublished release: DENIED, PASS.
- E active owning artist -> own eligible release: PASS across canonical release states.
- F different artist -> private release: DENIED, PASS; forged query-string ownership does not help.
- G authorized reviewer -> private release: PASS.
- H support/moderator without releases permission -> private release: DENIED, PASS; moderator catalog scope tested separately.
- I invalid/missing IDs: safe uniform 404, PASS.
- J published Range request: 206, expected bytes/length/Content-Range, PASS.
- K authorized private Range: 206 for owner and reviewer, PASS.
- L no response Storage secret/private/signed URL leakage: PASS for the tested serializers/media routes.

Additional checks: old object URLs protected; hidden/removed content denied; bucket-public flag denies streaming; expired/forged preview cookies denied; bearer precedence and cross-site rejection; unsigned normalization of legacy signatures; safe external URL handling; 416 Content-Range preserved; no auto-publication or session write in media SQL; existing Admin loading, snapshot loading, discovery, playlist and sharing regressions pass.

The PostgreSQL test uses the real application query with in-memory test tables, not a production connection. It verifies actual joins and predicates, including a due-but-still-scheduled release with an artificially published linked song. The release remains scheduled after all media checks.

Browser verification used actual current Admin HTML, production auth/cookie handlers and streaming code with synthetic account/database/media fixtures in headless Edge:
- Native HTML audio playback: PASS.
- Seek to 60 seconds in a generated 90-second WAV: PASS.
- Two browser Range requests observed.
- HttpOnly/Strict/path-scoped cookie: PASS.
- Preview after logout: 404, PASS.
- Page script errors: none.

Syntax check and `git diff --check`: PASS. No live artist audio was requested. Temporary test servers were stopped.

To rerun the PostgreSQL-inclusive tests, set `TESO_AUDIO_PGLITE_MODULE` to the external test installation's `@electric-sql/pglite/dist/index.js`, then run `node --test tests/*.test.js` inside backend-js. Without that optional module, the isolated PostgreSQL test explicitly skips; the other tests need only existing project dependencies.

## 11. Range and Performance

Range headers pass through unchanged to Supabase. Successful streaming preserves 206, Content-Range, Content-Length, Accept-Ranges and audio Content-Type. Invalid ranges preserve 416/Content-Range. The response is streamed rather than buffering an entire recording into a browser Blob. Admin seeks were exercised in a real browser with synthetic audio.

Each media request adds one bounded authorization SQL query before Storage access. New ID-based routes use primary-key lookups. Legacy object-path URLs may require audio_path scans; no new indexes were added. No production latency figures are claimed. Auth decisions are not cached, so status/ownership changes apply to subsequent requests. Already delivered bytes cannot be revoked.

Physical Android playback/seeking, PWA playback against the deployed backend, proxy latency under production load and actual Supabase Range behavior remain approved rollout checks. Local tests verify the HTTP contract, not physical-device behavior.

## 12. Deployment Risk and Remaining Gates

Risk: security-critical backend change, locally validated but not production-certified.

Before an approved deployment:
1. Read-only verify that the configured live audio bucket is private and the DB role can read its metadata.
2. Read-only inventory published media references: identify residual local paths, unsupported external/query-token URLs, inactive artists or inconsistent source-release/public-song links that will correctly fail the new gate. Do not edit these automatically.
3. Review the explicit policy that only active artists' songs are public. Suspended artists previously passed the looser listing filter.
4. Deploy backend and its bundled Admin JavaScript together; existing Admin tabs should reload to get renewal/logout handling.
5. Verify a known public song on physical Android and PWA, including several seeks and old cached object URLs. Use a designated synthetic private release for any deployed owner/reviewer denial test; never probe unrelated unreleased recordings.

No listener OTA/PWA or APK release is required for this backend response-compatible change. No new artist-preview UI was added. Public HTTPS external provider redirects still depend on that provider and cannot revoke previously public third-party recordings.

P0-B and P0-C risks still exist and are explicitly outside this implementation. This is not a declaration that the entire Admin security audit is resolved.

## 13. Rollback Plan

No production rollback is currently necessary because nothing was deployed. There are no data/schema migrations to reverse.

For a future rollout incident, prefer a fix-forward or temporary fail-closed disablement of private previews while retaining the public authorization/range path. If reverting the complete backend change is unavoidable, do not restore the old unrestricted media proxy on a public service: retain an ingress/application block on the vulnerable audio and legacy local-file routes until the guard is restored. Availability may be reduced during that emergency; acknowledge that explicitly rather than reopening private audio.

Source changes are limited to the listed files; the pre-existing schema-script modification must not be bundled into an audio rollback. Existing JSON/uploads remain untouched and are not automatically re-enabled by Supabase errors.

## 14. Release Confirmation

- No production schema or bucket change.
- No artist application, release status, song, playlist or user record modified.
- No migration rerun.
- No native/APK/signing changes or new APK.
- No commit/push, Render deployment, OTA publication or PWA publication performed.
- No P0-B/P0-C implementation or Admin UI redesign.

Stop here for review and deployment approval.
