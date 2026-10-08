# Engagement Counts: Local Fix Review

Status: local implementation only. No push, deployment, production request/data
change, schema change, containment edit or migration 006 execution. Existing paused
Admin Accounts work in this worktree was preserved, not included in this fix.

## Root Cause and Reproduction

Both Supabase write methods used data-modifying CTEs with a final SELECT COUNT(*)
from the base engagement table in the same SQL statement. PostgreSQL gives those
parts the same pre-write snapshot. The engagement row is written, but the returned
count excludes the insert (or still includes the deleted row).

On local real PostgreSQL, before this fix:
- First follow: artist_follows COUNT(*) = 1; response follower_count = 0.
- First like: song_likes COUNT(*) = 1; response like_count = 0.
- Removal of two matching account/device rows: actual count = 0; response = 2.
- New regression run: 2 passed, 11 failed including the failed parent test.

This reproduces the reported symptoms without production access. It is a backend
calculation/snapshot bug, not a field-name mismatch. The frontend then correctly
trusts the incorrect server zero, replacing its optimistic one and retaining that
value in its in-memory count override. Thus the display can remain zero even when
another detail/catalog response contains a newer count. This does not mean the
underlying like/follow failed or was deleted.

## Follow Trace

ArtistDetailScreen.handleFollowPress / ArtistCard
-> EngagementContext.followArtistAction or unfollowArtistAction
-> musicApi.followArtist / unfollowArtist -> postDeviceAction
-> POST /api/artists/:id/follow/ or /unfollow/
-> server.js resolves listener and device, invokes Supabase persistence
-> tesohub_music.artist_follows (artist_id, listener_id, device_id)
-> JSON {followed: boolean, follower_count: number}
-> EngagementContext.actionCount -> artistFollowerCounts[id]
-> getArtistFollowerCount -> artist header/card formatting.

Initial count: GET /api/artists/ and /api/artists/:id/ expose follower_count from
SQL COUNT(*) grouped by artist_id. The row serializer converts it to a number;
directArtistResponse retains it. ArtistDetailScreen initially calls getArtist.
Optimistic count is currentCount + 1 or max(0,currentCount - 1). A numeric server
follower_count, including genuine zero or a value lower than optimistic, wins.
Failure restores the previous count/membership and shows an error. Pending refs
prevent duplicate actions. The detail screen also stores successful response counts
in its artist object; Undo uses the same follow endpoint.

## Like Trace

SongCard / PlayerScreen
-> EngagementContext.toggleSongLike -> musicApi.likeSong / unlikeSong
-> POST /api/songs/:id/like/ or /unlike/
-> server.js resolves listener/device -> Supabase persistence
-> tesohub_music.song_likes (song_id, listener_id, device_id)
-> JSON {liked: boolean, like_count: number}
-> EngagementContext.actionCount -> songLikeCounts[id]
-> getSongLikeCount -> card/player display.

Initial count: SQL COUNT(*) grouped by song_id in listPublicSongs/getPublicSong,
exposed as numeric like_count. Same optimistic increment/decrement, server-wins
reconciliation, duplicate guard and error rollback as follows. No likes_count,
followers_count or follow_count mismatch was found in these paths.

## Serializers, Projections and Cache

- Artist list/detail/discovery share listPublicArtists/getPublicArtist and
  publicArtistFromRow; all use tesohub_music.artist_follows.
- Song list/detail/discovery share listPublicSongs/getPublicSong and
  publicSongFromRow; all use tesohub_music.song_likes.
- directArtistResponse/directSongResponse preserve count fields and only rewrite
  media URLs. /song/:id sharing uses getPublicSong in Supabase mode; its HTML need
  not display a like count, but the backing object is the same projection.
- Playlist song projections aggregate the same song_likes table.
- Snapshot serializers (Artist Studio, applications, Admin and legacy-mode paths)
  count db.artistFollows/db.songLikes. Supabase loadDb populates these from qualified
  tesohub_music tables, not public aliases.
- Normal catalog reads are network-first with real-data offline fallback. Discovery
  coalesces concurrent requests but removes the in-flight entry after completion.
- EngagementContext overrides are not count values persisted in AsyncStorage;
  membership IDs are cached. Old object counts cannot replace an acknowledged action
  count during navigation. Fresh provider/reload uses fetched catalog counts.
- Existing already-open clients may retain a zero obtained before deployment until
  reload/restart or another successful action. Counts are not realtime subscriptions;
  another user's later action need not appear instantly. Offline caches can be old.

## Containment Independence

Searched current JS/TS/SQL/Python source, serializers, migrations, client APIs and
RPC patterns for public.follows/likes/profiles/song_plays and unqualified reads.
Matches were security-review fixtures/documentation; no application dependency on
those four public tables was found. SQL aliases named likes/follows refer to
aggregations of qualified authoritative tables, not legacy public objects.
The new engagement fixture does not even create the four legacy tables.

Containment did not cause the reproduced defect. Nothing reopens client access,
alters RLS/grants or edits any security-review SQL. Local containment regressions
exercise the unchanged patch in disposable databases only.

## Exact Fix

mutateEngagementWithCount checks out one existing pooled connection and performs:
1. BEGIN ISOLATION LEVEL READ COMMITTED.
2. Existing guarded engagement mutation CTE, returning target existence only.
3. Separate parameterized SELECT COUNT(*) against the relevant authoritative table.
4. COMMIT before returning the original JSON contract; rollback on errors and always
   release the connection.

The second statement sees its own transaction's mutation and other transactions
committed before that count statement. Counts are point-in-time values, not a promise
that no later concurrent action can change them. No catalog reload, local fake count,
snapshot import or new connection pool is introduced. Existing targeting, ownership
promotion and ON CONFLICT behavior are preserved. A count error rolls back writes.

Tradeoff: successful mutations now use four statements (BEGIN, mutation, count,
COMMIT), versus one statement before. Only two perform data work; one indexed
single-entity count replaces the old embedded count. Production latency has not
been benchmarked in this local-only task. Do not revert to snapshot arithmetic to
save round trips: concurrent duplicate requests can still produce a wrong count.

## Tests

New backend coverage for both actions: zero -> one, N -> N+1, two users, duplicate
requests, unfollow/unlike, real COUNT(*) agreement, fresh detail/list and all four
discovery projections, device-to-account promotion, multi-row removal, concurrent
duplicate requests, count-error rollback for add/remove, and missing targets.

Extended actual React provider tests for both count fields with initial 0 and 7:
visible optimistic increment while request is pending, duplicate suppression,
authoritative reconciliation, true zero on removal, error rollback, stale-object
protection, provider remount and persisted membership. No frontend runtime changes.

The Admin Accounts suite is deliberately excluded because it executes migration
006; this is not a claim that every test file in the dirty worktree was executed.
Initial selected regression results: Backend/Admin 204 tests, 202 passed, 2 failed,
0 skipped. The two failures represent ONE browser audio-retry subtest plus its
parent suite (release-review-browser.test.js:94), not two engagement failures.
Listener/mobile: 46 passed, 0 failed, 0 skipped; its four new React scenarios run
inside the existing listener-player script. Combined: 248 passed, 2 failed,
0 skipped. The 13-test engagement PostgreSQL suite is green. P0-A, P0-B, P0-C,
Artist Applications and containment tests passed in that run. Release Review
API/persistence tests pass, but its browser regression gate is NOT fully green.
Syntax and git diff --check passed. That initial gate was held pending the browser
investigation below; the final green results supersede those initial totals.

Test environment notes: the first broad run hit an existing P0-C publisher lock
assertion because fixture CURRENT_DATE in Africa/Nairobi had advanced to October 9
while the publisher correctly compared UTC October 8. Re-run uses UTC on the owned
disposable PostgreSQL instance only. A subsequent run also hit an intermittent
Chrome audio-retry NotSupportedError. Runtime was not edited; the subsequent
approved regression investigation below fixes only the browser test synchronization.

## Release Review Regression Investigation

The failed expectation was successful audio.play() after clicking Retry audio.
Actual failure: locator.evaluate rejected with NotSupportedError: The element has
no supported sources. Original stack:

```text
TestContext.<anonymous> (backend-js/tests/release-review-browser.test.js:94:110)
async TestContext.<anonymous> (backend-js/tests/release-review-browser.test.js:86:3)
```

The Admin Retry handler awaits api('/admin-api/me') before calling audio.load().
Playwright click() does not await that asynchronous handler. The old test immediately
called play() while the media element could still have its prior forced 503 error.
That is a synchronization race, not proof that the Retry handler failed.

Comparison baseline: b963f5e68f4bf56a83c649b2a18e3dc758f779d4. Archived only its
unchanged Admin HTML, original test, package metadata and synthetic-media asset into
an isolated temporary directory, preserving every working file. The archived HTML
blob hash equals the commit's blob d322fd1741763913f4d259b94e0863414a85766d.
The browser test uses a local mock HTTP server and does not import server.js or
supabasePersistence.js. Thus engagement persistence is absent from its execution.

- Original timing: current code 5/5 pass; unchanged baseline 5/5 pass.
- Controlled 250ms delay of the mock identity response, unchanged runtime/old
  assertion: current 3/3 fail; baseline 3/3 fail with the exact same stack/error.
- This establishes existing timing-sensitive test behavior, independent of the
  engagement fix. Only the local mock latency changed in the baseline experiment.

Test-only repair: retain realistic delayed identity renewal, await its 200 response,
await the actual retried audio 206 response, assert a valid Content-Range, wait for
media readiness with no error, then play and verify time advances before pausing.
Also reassert HttpOnly-cookie invisibility and unchanged release status. The test
does not call load() or clear errors on behalf of the application. No assertion was
removed and no runtime/private-audio code was changed.

Final verification after test-only repair:
- Corrected isolated browser suite with delayed renewal: 5/5 runs pass, each
  8 passed / 0 failed / 0 skipped (including the suite parent).
- Full selected Backend/Admin suite: 204 passed / 0 failed / 0 skipped.
- Listener/mobile: 46 passed / 0 failed / 0 skipped.
- Combined final gate: 250 passed / 0 failed / 0 skipped.
- Includes all 13 engagement tests, unchanged containment tests, P0-A private
  audio/Range, P0-B permissions, P0-C independent PostgreSQL connections,
  Artist Applications, Release Review API/persistence/browser, and listener tests.
- Syntax checks, git diff --check and secret-pattern scan pass.
- Migration 006 and its separate Admin Accounts suite remain excluded, not run.
  Zero skipped refers to the selected relevant suites, not that excluded workstream.
- No production queries, modifications, credentials, pushes or deployments.

READY_FOR_ENGAGEMENT_COUNT_DEPLOY = YES for this reviewed scope, pending user
approval and a clean release preparation that excludes unrelated paused Admin work.
Backend-only deployment remains sufficient. SCHEDULED_PUBLISHER_ENABLED was not
changed or enabled; production's reported disabled setting was not re-queried.
Containment SQL and migration 006 hashes match before/after this gate:
containment 9A94765D1DE094EE997733307D220B47F11D1591C6773CD636A66B05B573E368;
006 26A7F7997D7562358DEA4C8A755712FC07E2A92ED0AA78FBEA04AF8B64C62F23.

Transaction audit: all four engagement methods await mutateEngagementWithCount.
The helper acquires one pooled client, begins READ COMMITTED, awaits the guarded
mutation and then a separate authoritative count on that same client. Own writes
are visible inside the transaction before global commit. COMMIT is awaited before
the helper/method returns and the HTTP route's res.json executes. Errors take the
ROLLBACK path; finally releases the client. Existing database uniqueness plus
ON CONFLICT preserves idempotency, including concurrent duplicate fixture requests.
There is no catalog-wide reload or reference to public.likes/public.follows.

## Files in This Task

- backend-js/supabasePersistence.js: only engagement transaction/count helper and
  four action call sites. The preexisting getAdminPool export belongs to paused
  Admin Accounts work and is NOT part of this fix's release scope.
- backend-js/tests/engagement-counts-postgres.test.js: new local PostgreSQL fixture.
- backend-js/tests/release-review-browser.test.js: test-only async retry synchronization.
- tests/engagement-counts-ui.cjs: the four additional engagement scenarios, kept
  outside the mobile root so this backend release cannot trigger the PWA via a
  mobile-file change. The existing mobile test script is unchanged in this branch.
- backend-js/tests/public-schema-security.test.js and the two SQL files in
  backend-js/security-review/: unchanged, local-only containment regression fixtures.
  They are not migrations and are not executed by npm start or Render deployment.
- ENGAGEMENT_COUNTS_REVIEW_2026-10-09.md: this review.

Release requirement after approval: backend deployment only. No runtime frontend
change, OTA/PWA publication, new APK, native change, schema migration or data repair
is required. Prepare a clean release excluding all paused Admin Accounts changes.
Production data changed: NO. Production schema changed: NO. Pushed: NO. Deployed: NO.

## Clean Release Preparation

Branch codex/engagement-count-release starts from fetched origin/master
b963f5e68f4bf56a83c649b2a18e3dc758f779d4. Only the engagement function region was
copied into supabasePersistence.js; the paused getAdminPool export and all other
Admin Accounts work are absent. All mobile files, Admin HTML, server.js, existing
migrations, render.yaml, environment and native configuration remain byte-identical
to the release base. Reusing installed dependencies through ignored local junctions
does not add any dependency files to this release.

The deployment path is GitHub fast-forward master plus the existing backend
Auto-Deploy. Public-schema containment was already manually applied; this release
does not run it. No migration is part of startup. Scheduled publishing remains
default-off; the production operator's explicit false setting must remain unchanged.

Clean-branch final gate: backend 204 passed / 0 failed / 0 skipped; listener/mobile
50 passed / 0 failed / 0 skipped (46 existing plus four standalone engagement UI
cases). Tests ran against this clean branch, not the paused feature worktree.
Syntax checks and staged git diff --check passed. No mobile-root file is in the
release diff, and no migrations or production configuration files changed.
