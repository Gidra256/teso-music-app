# P0-C scoped writes: local audit and implementation

Date: 8 October 2026. Status: LOCAL ONLY, pending review. No commit, push, deployment, production request, credential access or production data change during this work.

Branch: `codex/p0-c-scoped-writes`, created from `4aeb2dfd17fc744e8330dbbb401a476aacd648e4` in the existing isolated worktree. The P0-B branch/commit and the original working checkout are preserved.

Owner-supplied production status: P0-B CLOSED; P0-A deployed with core protections active. This task does not re-test production or claim completion of the deferred private-fixture staging work.

## 1. Architecture and invariant

Production uses `createSupabasePersistence` and its reusable `pg.Pool`, PostgreSQL tables in `tesohub_music`, and Supabase Storage. Listener registration/login, likes/follows, playlists and Support already have dedicated SQL methods. Several other routes retain JSON-era DTO logic: load the application, modify an object, then call `server.saveDb`.

Before P0-C, Supabase `saveDb` treated that DTO as an authoritative replacement for fifteen tables. A transaction made the replacement atomic, but did not make its old data current. Direct listener writes could be erased by any subsequent snapshot save.

**Invariant for normal Supabase application saves:** only explicitly changed DTO rows and persisted fields are written. Missing rows in a stale read are never treated as deletions. An intentional deletion must be a specific row present in that request's immutable baseline and removed by its operation. Unchanged collections and columns are not sent as SQL writes. Multi-record workflow changes and their audit entry commit or roll back together.

Large reads remain for compatibility; this is not a read-performance redesign. The old snapshot is a change-detection baseline, never the desired state of unrelated records.

## 2. Exact vulnerable writer

Old chain: route -> `loadDb` / `loadDbWithPublishedReleases` -> DTO edits -> `server.saveDb` -> `supabasePersistence.saveDb`.

| Old writer behavior | Data exposed to stale overwrite or deletion | Risk |
|---|---|---|
| Upsert every listener | Name/contact, password hash, role/plan/status, artist/application linkage | CRITICAL |
| Upsert every artist, genre, application, song and release | Metadata, review/publication states, artist ownership, media references, play counts | CRITICAL |
| Delete all likes/follows and rebuild from snapshot | New likes/follows lost; removed ones resurrected; identities/timestamps rewritten | CRITICAL |
| Upsert all playlists, delete/rebuild playlist songs | New playlists lost; removed songs restored; additions lost; renamed lists reverted | CRITICAL |
| Upsert all auth tokens then delete absent tokens | New sessions removed; revoked sessions restored; activity regressed | CRITICAL |
| Upsert all reports/settings/audit and replace feature flags | New reports/logs lost; security/configuration decisions reverted | CRITICAL |
| `deleteMissing` across ten entity tables | Any concurrent insert absent from the stale snapshot deleted, including FK cascades | CRITICAL |
| Snapshot IDs allocated using `nextIds = max + 1` and upsert | Concurrent creations overwrite each other rather than generating distinct rows | HIGH |
| Snapshot-based song play increment | Concurrent increments lost; formerly also invoked the global writer | HIGH |
| Scheduled SQL publication without locking its selected release | Concurrent publication could insert multiple catalog rows for one release | HIGH |

Support tables and listening_history were not themselves included in the old snapshot writer. However, deletion of their referenced listeners/songs could cascade or null relationships. A new Support audit entry could be deleted by an unrelated snapshot save.

## 3. Complete application write-path inventory

Classes: **A** row-scoped SQL; **B** transaction/atomic multi-row SQL; **C** changed-field patch; **D** whole collection rewrite; **E** whole application rewrite. `S` below means old `server.saveDb -> Supabase.saveDb` (**E/D**, CRITICAL), now `server.saveDb -> saveChanges -> applyScopedChanges` (**A+B+C**). Audit rows listed with a workflow are inserted in its transaction. Intended FK cascades on explicit permanent deletion remain part of that operation.

### Admin mutations

Every route in this table has `/admin-api` prefix. P0-B guards and P0-A preview behavior are unchanged.

| Method / route | Persistence function | Owned data after fix | Before -> after |
|---|---|---|---|
| POST /artists | S | New artist + audit | E -> A/B |
| PUT /artists/:id | S | Changed artist fields + audit | E -> A/B/C |
| DELETE /artists/:id | S | Soft status; or explicit artist/song/follow rows with dependent FK cascades; audit | E -> A/B/C |
| POST /artists/:id/suspend | S | Artist status + audit | E -> A/B/C |
| POST /artists/:id/restore | S | Artist status + audit | E -> A/B/C |
| POST /artists/:id/feature | S | Artist featured flag + audit | E -> A/B/C |
| POST /artists/:id/unfeature | S | Artist featured flag + audit | E -> A/B/C |
| POST /songs | S | New song + audit | E -> A/B |
| PUT /songs/:id | S | Changed song metadata/media/count fields + audit | E -> A/B/C |
| DELETE /songs/:id | S | Soft status; or specific song and likes with dependent FK cascades; audit | E -> A/B/C |
| POST /songs/:id/hide | S | Song status + audit | E -> A/B/C |
| POST /songs/:id/restore | S | Song status + audit | E -> A/B/C |
| POST /songs/:id/remove | S | Song status + audit | E -> A/B/C |
| POST /songs/:id/feature | S | Song featured flag + audit | E -> A/B/C |
| POST /songs/:id/unfeature | S | Song featured flag + audit | E -> A/B/C |
| POST /genres | S | New genre + audit | E -> A/B |
| PUT /genres/:id | S | Genre fields + audit | E -> A/B/C |
| POST /genres/:id/activate | S | Genre active flag + audit | E -> A/B/C |
| POST /genres/:id/deactivate | S | Genre active flag + audit | E -> A/B/C |
| PUT /platform-settings | S | Changed settings fields/derived flags + audit | E -> A/B/C |
| PUT /feature-flags | S | Individually changed flag keys + settings audit metadata + audit | E/D -> A/B/C |
| POST /reports/:id/status | S | Report status/notes + audit | E -> A/B/C |
| POST /artist-applications/:id/approve | S | Application, applicant artist linkage/role, created artist, audit | E -> A/B/C |
| POST /artist-applications/:id/reject | S | Application review and applicant role/linkage + audit | E -> A/B/C |
| POST /artist-applications/:id/request-changes | S | Application review and applicant role/linkage + audit | E -> A/B/C |
| POST /releases/:id/approve | S | Release approval/schedule/publication, new linked catalog song when due, audit | E -> A/B/C |
| POST /releases/:id/reject | S | Release review state + audit | E -> A/B/C |
| POST /releases/:id/request-changes | S | Release review state + audit | E -> A/B/C |
| POST /users/:id/suspend | S | Account status/reason, its snapshot-visible sessions, audit | E -> A/B/C |
| POST /users/:id/restore | S | Account status/reason + audit | E -> A/B/C |
| POST /users/:id/revoke-sessions | S | That account's snapshot-visible sessions + audit | E -> A/B |
| POST /support/tickets/:id/replies | addSupportAdminReply; auditSupportAction -> recordAdminAuditLog | Ticket, new public message, audit append | B + A, SAFE from snapshot overwrite |
| POST /support/tickets/:id/notes | addSupportInternalNote; recordAdminAuditLog | Ticket timestamp, new internal note, audit append | Atomic CTE + A, SAFE |
| PATCH /support/tickets/:id | updateSupportTicketForAdmin; recordAdminAuditLog | Locked ticket, optional assignment history, audit append | B + A, SAFE |
| POST /login | Configured credential/role check | No database write; returns existing configured token | No persistence mutation |
| DELETE /audio-preview-session | clearCookie | Response cookie only | No persistence mutation |
| POST /supabase-migration/schema | startMigrationJob -> apply-supabase-schema.js | Explicit schema/bucket maintenance | Privileged maintenance; see section 5 |
| POST /supabase-migration/migrate | startMigrationJob -> migrate-json-to-supabase.js | Explicit import target rows/media/sequence state | Privileged bulk B; HIGH if run against active production |
| POST /supabase-migration/validate | startMigrationJob -> validate-supabase-migration.js | Database/Storage reads; in-process job status/logs | No application data write |

No separate Admin user/role-management endpoint exists. Discovery curation writes are the artist/song feature routes and guarded metadata fields above, not a separate discovery-save route.

### Listener mutations

| Method / route | Supabase function/path | Tables and fields | Classification / risk |
|---|---|---|---|
| POST /api/auth/register/ | createListenerAccount; attachDeviceEngagement | New listener/session, matching device's unowned likes/follows | B, SAFE from unrelated overwrite |
| POST /api/auth/login/ | createAuthSession; attachDeviceEngagement | New auth token and matching device engagement linkage | B, SAFE |
| PUT /api/auth/me/ | S | Changed profile/contact fields and current session activity | E -> A/B/C |
| POST /api/auth/logout/ | S | Specific token(s) matching caller's token hash | E -> A/B |
| POST /api/artist-applications/ | S; uploadFile | New application, applicant pending role/linkage, current session activity; avatar object | E -> A/B/C plus Storage object upload |
| POST /api/songs/:id/like/ | likeSong | Target song/listener/device like; returned count | Atomic CTE, SAFE |
| POST /api/songs/:id/unlike/ | unlikeSong | Matching song like(s) only; returned count | Atomic CTE, SAFE |
| POST /api/artists/:id/follow/ | followArtist | Target artist/listener/device follow; returned count | Atomic CTE, SAFE |
| POST /api/artists/:id/unfollow/ | unfollowArtist | Matching artist follow(s) only; returned count | Atomic CTE, SAFE |
| POST /api/playlists/ | createPlaylist | New owned playlist | A, SAFE |
| PUT /api/playlists/:id/ | updatePlaylist | Supplied owned playlist fields, timestamp | A/C, SAFE for unrelated records |
| DELETE /api/playlists/:id/ | deletePlaylist | Owned playlist + membership FK cascade | A, SAFE |
| POST /api/playlists/:id/songs/ | addSongToPlaylist | One relationship, playlist timestamp | B, SAFE for unrelated records |
| DELETE /api/playlists/:id/songs/:songId/ | removeSongFromPlaylist | One relationship, playlist timestamp | B, SAFE |
| POST /api/songs/:id/play/ | old S; now recordSongPlay | Atomic increment of one currently public song's play_count | E/HIGH -> A; due publication retains existing behavior |
| POST /api/support/tickets/ | createSupportTicket; uploadSupportAttachment | Ticket + initial message; optional private Storage object | B, SAFE |
| POST /api/support/tickets/:id/replies/ | addSupportTicketReply; uploadSupportAttachment | Locked owned ticket + reply; optional private object | B, SAFE |
| POST /api/reports/ | S | New report + session activity if present | E -> A/B |

The listening_history table exists but there is no backend listening-history insert route in current server/persistence code. Recently Played state is client-managed; play requests persist song counts. P0-C adds no new history product feature. A synthetic listening_history row is included in preservation tests.

### Artist Studio mutations

| Method / route | Persistence path | Owned records | Before -> after |
|---|---|---|---|
| POST /api/artist-studio/releases/ | S; uploadFile | New draft/submitted release, session activity; audio/artwork objects | E -> A/B/C plus object uploads |
| PUT /api/artist-studio/releases/:id/ | S; uploadFile | Editable owned release metadata/media, optional submission state, session activity | E -> A/B/C plus object uploads |
| POST /api/artist-studio/releases/:id/submit/ | S | Owned release submission/review fields and session activity | E -> A/B/C |
| PUT /api/artist-studio/profile/ | S; uploadFile | Owned artist name/bio/location/photo and session activity | E -> A/B/C plus avatar object |

No separate generic upload-persistence route exists: multipart uploads occur inside the artist/application/catalog routes listed above. Supabase uploads go to unique object paths and never permanently to Render local uploads. Storage writes cannot share a PostgreSQL transaction; see limitations.

### Read routes with write side effects and helpers

- `listenerByTokenHash` updates only the matching auth token's `last_active_at` in a CTE. `requireSupabaseListener`/`supabaseListenerFromRequest` invoke it from authenticated auth/engagement/playlist/Support reads and mutations. SAFE for unrelated rows.
- Legacy `findListenerByToken` touches only the in-memory session until a route saves. Those session fields now persist through scoped patches, with monotonic activity timestamps.
- `loadDbWithPublishedReleases` could previously trigger the whole writer from GET Studio dashboard/releases, hub search documents, featured artists/songs, and Admin discovery/releases/release detail/artists/songs. These paths now save only publication changes. If a due publication commits, a fresh tracked DTO is returned so a subsequent independent save has a valid baseline.
- Public GET artists/artist detail/songs/song detail and the `/song/:id` share page use dedicated `listPublicArtists`, `getPublicArtist`, `listPublicSongs`, `getPublicSong`; those call SQL `publishDueReleases`. This was already scoped. The due-selection CTE now uses row-level `FOR UPDATE SKIP LOCKED` to prevent simultaneous publishers from inserting duplicate songs. Existing visibility/eligibility conditions are unchanged.
- Public playlist reads and JSON-mode catalog paths have `loadDbWithPublishedReleases` only in their JSON branch; direct Supabase playlist methods do not publish.
- GET `/api/auth/me/` calls `listenerByTokenHash` in Supabase mode, not the snapshot writer. Its JSON branch still saves the JSON file.
- GET `/admin-api/me` writes an eligible preview response cookie only. Audio stream/storage routes do not invoke either publisher or database writes; P0-A is unchanged.
- `ensureDb` creates a default JSON database only in explicit JSON mode. Supabase mode asserts configuration and never creates/seeds a JSON fallback.
- GET persistence-export, migration-job reads, platform-health, audit-log and ordinary Support reads do not save application snapshots.

## 4. Implementation and concurrency

`server.loadDb` records an immutable before-image in a WeakMap keyed by the request's DTO, with the original persisted representation separate from UI normalization defaults. The request cannot supply or replace this baseline. JSON seed genres are not treated as real Supabase rows. `server.saveDb` in Supabase mode requires that tracked baseline and calls `saveChanges`; an untracked object is rejected. JSON mode retains its existing file-write path.

`applyScopedChanges` uses a fixed allowlist mapping legacy DTO names/media fields to actual tables and columns. It builds per-table insert/update/delete plans, never a whole-table desired state. SQL values are parameters; table/column identifiers come only from the static mapping. Normalization defaults do not themselves generate writes.

`saveChanges` uses BEGIN/COMMIT/ROLLBACK on one pooled connection. Inserts use PostgreSQL sequence-generated IDs, remapping only the action's references, including release/song/application/listener and audit references. No `ON CONFLICT(id) DO UPDATE` creation fallback can overwrite a concurrent new entity. Sequence collisions, FK violations, serialization conflicts and deadlocks become a safe conflict response, not a fallback snapshot rewrite. Generated IDs are reflected into response objects only after COMMIT.

Updates send only changed columns. Conditional predicates check their persisted old values plus lifecycle/ownership fields. Same-field changes since the server read cause rollback and safe HTTP 409. Independent field changes can merge. Deleted/changed targets are never silently recreated. All workflow updates and its snapshot audit append share the transaction. Timestamp comparisons account for JS millisecond versus PostgreSQL microsecond precision; activity/update timestamps never move backward.

Intentional permanent parent deletion still uses database FK cascades for its current owned dependents, including any new likes/membership rows for that deleted parent. That is the explicit deletion's scope, not unrelated-data loss.

`recordSongPlay` uses `play_count = play_count + 1` and existing public-song/active-artist/source-release predicates. Catalog metadata updates that did not change play_count never rewrite it. No listening-history feature was added.

No broad table/advisory locks were introduced. Normal updates/deletes take PostgreSQL's normal row locks. Existing scheduled publication additionally locks only selected due-release rows. Full read snapshots are not transactionally consistent across tables; scoped predicates, FK constraints and rollback protect the affected writes, without making those snapshots authoritative for other data.

## 5. Maintenance and JSON rollback boundary

These existing maintenance tools were audited but intentionally not run or modified:

| Tool / function | Writes | Classification / limitation |
|---|---|---|
| migrate-json-to-supabase: upsertListener/upsertArtist/upsertSong/upsertGenre/upsertApplication/upsertRelease/upsertSimpleRows | Explicit source rows in all legacy collections, Storage objects, legacy_media_migrations, migration_runs | Bulk transactional upsert, not normal CRUD. HIGH: stale imported rows can overwrite live matching rows. Requires a separately approved quiesced import/cutover, not concurrent normal service use. |
| migrate-json-to-supabase: resetSequences | Identity sequence positions | HIGH during active concurrent inserts; use only in controlled maintenance. |
| apply-supabase-schema | Supplied migration SQL and Storage bucket configuration | INFRASTRUCTURE; existing Super Admin guard/confirmation preserved. |
| import-from-django | Complete local JSON database | E; explicit offline JSON import, not used by production Supabase requests. |
| restore-render-songs / sync-to-render | Artist/song POST/PUT via existing Admin API | Now inherit scoped server mutations; no alternate database writer. |
| export-render-persistence | Local export artifacts; remote GET only | Does not write production persistence. |
| validate-supabase-migration | Database/Storage reads | No database writes. |

P0-B's authorization and explicit migration behavior were not changed. P0-C does **not** make an intentionally destructive/full-source maintenance import safe to run against active traffic. That remains a separately controlled operation, not an ordinary save. No old migration, rollback JSON file, upload or backup was changed/deleted.

Explicit JSON mode still performs its legacy whole-file save and retains its pre-existing multi-request concurrency limitation. Supabase failures never fall back to it. Fixing JSON multi-writer behavior is outside this production Supabase change.

## 6. Tests and evidence

Initial relevant suite: **107 passed, 0 failed, 0 skipped** (83 existing + 24 reported P0-C tests including the PostgreSQL parent group). Final independent-session gate adds 11 tests: **118 passed, 0 failed, 0 skipped**. P0-A authorization/Range tests, P0-B four-role and invalid-role matrices, Admin loading, public discovery, playlist parity and sharing all pass.

New tests use an isolated PGlite PostgreSQL engine with the repository's existing 001 and 004 schema definitions; only the unavailable pgcrypto extension declaration is omitted. These are disposable local fixtures, never DATABASE_URL or production credentials. The test pool models one checked-out connection per transaction. These are SQL-engine integration/stale-interleaving tests, not multi-host production/load tests or a new staging environment.

Coverage:
- A follow/count preservation plus unfollow not resurrected.
- B like/count preservation plus unlike not resurrected.
- C concurrent playlist/account/session insert preservation.
- D playlist add/remove/rename/delete preservation.
- E profile/contact and session-revocation preservation.
- F application creation, pending role and generated FK linkage.
- G Studio release creation/edit/submission preservation.
- H two different-record Admin edits both survive; exactly two artist UPDATEs, no unrelated DML.
- Actual Admin artist-edit callback plus real server bridge/persistence with a follow interleaved after its read.
- Same-field conflict rolls back audit and data; independent fields merge.
- Concurrent creations allocate distinct IDs and remap release/song/artist/audit references.
- Publication versus stale Studio edit respects lifecycle guards.
- Specific hard-delete/FK cascades and no resurrection of deleted targets.
- Settings, individual flags, genres, reports and audit preservation.
- Atomic concurrent play increments; hidden music not incremented.
- Missing baseline rejected; old Supabase saveDb/deleteMissing writer absent.
- No-op saves issue no table mutations and preserve audit/Support/history.
- Real Support create/reply/note/assignment workflows and listener privacy.
- Microsecond timestamp deletion, monotonic session activity and null original fields.
- Normalization defaults do not seed/overwrite unrelated rows.
- Constraint failure rolls back the whole transaction without phantom IDs.
- Due publication remains scoped/idempotent, preserving engagement/account rows.
- Server baseline immutability, JSON fallback compatibility, one-save lifetime and actual safe 409 error middleware.

Additional gates: syntax checks, diff whitespace check, secret-pattern scan, and byte-comparison of P0-A media functions and P0-B role/permission guards. No existing tests were weakened or removed.

## 7. Files and methods

1. `backend-js/server.js`: tracked load/save bridge, no implicit Supabase seed genres, re-read after a completed due-publication transaction, direct atomic play path, safe 409 conflict response.
2. `backend-js/supabasePersistence.js`: remove global saveDb/deleteMissing/upsert-all writer; add saveChanges and recordSongPlay; due-publication row lock; create-only upload protection.
3. `backend-js/scopedChanges.js` (new): fixed DTO/column mappings, delta planning, targeted transactional SQL, generated ID/reference remapping and WriteConflict.
4. `backend-js/tests/scoped-writes.test.js` (new): SQL integration/concurrency and bridge/route regressions.
5. `P0_C_SCOPED_WRITE_REVIEW_2026-10-08.md` (this report).
6. `backend-js/tests/scoped-writes-postgres.test.js` (new): independent real PostgreSQL sessions, controlled overlap/lock observation, rollback, publication and upload-boundary tests.

No schema/migration files, package/dependency manifests, Admin UI, mobile/PWA/native configuration, P0-A module or P0-B permission implementation changed. No production data changed.

## 8. Remaining limitations and release risk

- A stale browser form submitted after another save has no client version/ETag. The fresh request baseline cannot know that the browser's intention came from an older version. Overlapping server-read/write conflicts are detected; older forms submitted later can still intentionally replace the same field. This is same-record UX/versioning work, not the unrelated-record overwrite fixed here. ABA changes are similarly not detected without versions.
- Unchanged SQL-specific playlist/Support methods remain scoped. Support ticket actions lock the ticket; playlist metadata is last-write-wins on supplied fields. Simultaneous playlist adds can still race on ordering/unique constraints; this pre-existing same-collection issue is separate from stale Admin snapshot erasure.
- Session revocation removes matching sessions visible in its read; a simultaneous later login can create a new session. Suspension still denies suspended-account access. No auth model change is included.
- Uploads precede SQL commit. A later conflict can leave an unreferenced Storage object; it does not delete a live object or publish a private release. Uploads now explicitly reject overwrites (`x-upsert: false`) even in the unlikely event of a generated-key collision. Orphan inventory/cleanup remains a later operational task; no cleanup feature was introduced.
- PostgreSQL sequences must be correctly initialized by the existing migration. A misaligned sequence fails closed with a conflict instead of overwriting a row. Aborted inserts can leave normal sequence gaps.
- Full read snapshots still cost memory/queries. No broad locking or snapshot refresh was used as the primary fix. Targeted workflow methods can replace the remaining read compatibility layer later.
- Maintenance imports and explicit JSON mode retain the boundaries described above. No claim is made that all possible maintenance/concurrent same-record operations are now conflict-free.

Deployment risk: **medium-high**, because one shared writer serves several validated workflows. The independent PostgreSQL release gate below passes locally. Before a separately approved release, review this six-file diff and verify sequence initialization and controlled maintenance procedures. This is not a production load test or evidence of production topology. No tests were run on production here.

Prefer fix-forward. Do not restore the global Supabase snapshot writer as an emergency fallback. If a specific workflow fails, temporarily block that mutation while retaining scoped writes and all P0-A/P0-B guards. There is no schema rollback to perform. A full rollback to 4aeb2df restores the known lost-update risk and should not be treated as safe under live concurrent traffic. Preserve the old JSON/export backup read-only for deliberately controlled recovery only.

## 9. Final independent PostgreSQL concurrency gate

### Environment and isolation

Used the installed PostgreSQL **18.3** executable to initialize a new local cluster under the system temporary directory, listening only on `127.0.0.1:55483`. No production credentials, DATABASE_URL, Supabase connection, or Storage account was used. The test harness explicitly supplies its local host/user/port and creates a uniquely named `p0c_gate_<pid>_<timestamp>` database. It drops only that database on completion. The disposable database uses the unchanged existing 001/004 schema plus a Storage bucket-table stub; there are no application migration/schema changes.

Two independent `pg.Pool` instances, each with its own PostgreSQL connection and `createSupabasePersistence` instance, execute the production persistence methods. A third observer session inspects database locks and committed state. `pg_backend_pid()` assertions prove all three sessions differ. There is no promise-tail mutex in this harness. Unlike the earlier PGlite harness, statements really overlap in separate PostgreSQL backends.

Test-only latches deliberately hold the first transaction open after an actual database update. For same-row tests the observer requires session B to be blocked on a PostgreSQL lock before allowing session A to commit. Different-row/listener/artist operations actually commit while A remains uncommitted. For publication, a disposable trigger and advisory lock hold A inside its real publication statement; B executes the unchanged production `FOR UPDATE SKIP LOCKED` statement concurrently. The trigger is removed after the test and never exists outside the disposable test database.

### Exact mechanism and process boundaries

- `saveChanges` checks out one connection, runs `BEGIN`, applies the scoped delta and audit inserts, then `COMMIT`; any error causes `ROLLBACK`, and the connection is released. Data/audit changes share the same transaction.
- UPDATEs set only changed columns and compare the previous persisted values of changed columns plus identity, lifecycle/status/role and ownership/FK columns using `IS NOT DISTINCT FROM`. PostgreSQL row locking and predicate rechecking after a wait prevent stale same-field overwrites. Different editable fields can merge. DELETEs compare the tracked persisted row (excluding volatile activity/update timestamps).
- Zero matched rows raises `WriteConflict` (`STALE_WRITE`). Unique/FK violations, serialization failures and deadlocks are also mapped to this conflict; the existing server error middleware returns HTTP 409 without SQL/secret details. Tests cover the database conflict and actual server 409 middleware separately.
- PostgreSQL sequences allocate IDs before inserts. Workflow FKs and audit target/details IDs are remapped within the transaction; response DTO IDs are reflected only after commit. Sequence gaps after rollback are normal, not committed partial records.
- The due-publication CTE locks releases with `FOR UPDATE SKIP LOCKED`; insert and release status/link update are one SQL statement. Another publisher skips a locked release. The later status update for an already-linked song is idempotent.
- `writeBaselines` is a server-owned WeakMap of request-local snapshots, not a cross-request lock/version authority. Each instance independently reads its baseline and PostgreSQL validates it against current rows. No sticky routing, shared JavaScript object, cached version or single-process mutex is required for these scoped writes.
- The lazily created pool is process-local for connection reuse only. The migration-job Map is process-local operational bookkeeping, not a normal CRUD safeguard; it does **not** prevent two hosts starting maintenance jobs. Operators must serialize/quiesce approved maintenance globally. No redesign was made to that separate boundary.

### Independent-session results

| Gate | Result | Evidence |
| --- | --- | --- |
| A: different artists | PASS | B commits while A is still open; both edits remain after A commits. |
| B: same artist, different fields | PASS | B demonstrably waits on A's database lock, then name and bio both survive. |
| C: same artist, same field | PASS | B waits, then receives STALE_WRITE; winner remains and losing audit is rolled back. |
| D: listener plus Admin | PASS | Follow/like/playlist creation and membership survive; subsequent unlike/unfollow/removal/rename are not resurrected by a stale Admin save. |
| E: artist plus Admin | PASS | Draft release, application, pending role and remapped application FK survive alongside an unrelated Admin edit. |
| F: rollback | PASS | After release/audit inserts and an artist UPDATE, an independent conflicting song edit forces rollback; none of the failed workflow commits, the independent edit survives, unrelated rows remain unchanged. |
| G: scheduled race | PASS | Two overlapping publishers create exactly one song; status is published and the bidirectional link is consistent; repeated attempts add nothing. |
| Generated IDs | PASS | Overlapping insert workflows receive distinct IDs and preserve artist/song/release/audit relationships. |
| Upload then ownership conflict | PASS | SQL rejects stale ownership, rolls back audit, keeps the existing audio reference/private status and leaves only an unreferenced synthetic object. |
| Upload collision policy | PASS | Separate names get unique generated paths; create-only Storage requests reject a simulated 409 and never issue delete/overwrite cleanup. |

Multi-process conclusion: scoped-write correctness is database-backed and remains valid for two Node processes/service instances or requests routed to different instances against the same PostgreSQL database. Independent sessions are directly tested; separate physical hosts, production network failures and load/failover are not simulated. No new correctness-critical in-memory lock was found.

### Maintenance and Storage boundaries

All `/admin-api/supabase-migration/*` operations remain protected by P0-B's `requireSuperAdmin`, including explicit confirmation for mutations. Only the dedicated maintenance routes invoke the migration scripts. Normal Admin/catalog/Studio saves call `saveChanges`, never the removed Supabase snapshot writer or bulk importer. Existing import tooling can still overwrite source-matching rows/reset sequences: stop live mutations across **all** instances and run only a separately approved controlled maintenance operation. The local migration-job Map is not a distributed maintenance lock.

Uploads use server-generated timestamp/UUID paths and now `x-upsert: false`. Artist handlers choose the authorized artist/release server-side; scoped UPDATEs guard persisted ownership/status. Failed transactions cannot commit the new object reference, publication link, or associated audit. There is no compensating object deletion on failure. An existing object's bytes/content-type metadata cannot be overwritten by this upload path, even on collision. These object API semantics are checked with a mocked Storage transport; database linkage/rollback is checked on real PostgreSQL. No real Storage object was uploaded/accessed. Unreferenced artwork/avatar objects can still exist in their existing public buckets; this is not a new promise that public image buckets become private.

### Reproduction and final-gate scope

With an isolated local PostgreSQL instance configured for the dedicated `p0c_fixture` user and no production credentials, run from `backend-js`:

```powershell
$env:TESO_P0C_POSTGRES_PORT = '55483'
$env:TESO_AUDIO_PGLITE_MODULE = "$env:TEMP\tesohub-audio-audit-tools\node_modules\@electric-sql\pglite\dist\index.js"
node --test --test-reporter=tap tests/*.test.js
```

Final-gate changes only: this report; the new `tests/scoped-writes-postgres.test.js`; one upload header in `supabasePersistence.js`. Other P0-C implementation files remain unchanged by this gate. No P0-A/P0-B behavior or tests were modified. Syntax, whitespace, scope and secret-pattern checks passed; no matched credential patterns were found in the six-file P0-C worktree diff/files.

Final gate: **PASS, ready for a separately approved controlled deployment**, with medium-high shared-writer rollout risk and the documented maintenance/old-form/orphan/sequence limitations. No schema files or Supabase schema changed. No production data changed. No APK/native/UI work occurred. No cleanup system was introduced.

**Nothing committed, pushed or deployed. Stop for review and approval.**
