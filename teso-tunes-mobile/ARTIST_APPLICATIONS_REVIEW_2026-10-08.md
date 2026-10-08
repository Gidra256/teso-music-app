# Artist Applications operations review

Local branch: `codex/admin-artist-applications`. Base: deployed P0-C commit `d839628e6df9d3213cb0195949f5638ef9d42e0e`.

## 1. Root cause and evidence boundary

Confirmed local operational defect: `loadResource` treated a successfully loaded Applications array as ready indefinitely. Returning via `setView` did not force a new read. An empty result loaded before an artist submitted could therefore remain empty even with All statuses selected. The original empty message also conflated an actually empty collection with a filtered collection. There was no Applications-specific Refresh control. A force refresh during an in-flight read was deduplicated into that older read and could miss a submission made after it began.

The shared filter event handler called `renderPreservingScroll` on every input event, replacing the input DOM node and losing focus. Applications previously had only a status filter, not a search field; the focus defect was in the shared mechanism that a new Applications search would otherwise inherit.

These paths are fixed and reproducibly tested. They are NOT proof of the cause of the affected artist's historical Under Review display. The initial development session's read-only `/admin-api/me` request returned HTTP 403 and inspection stopped. Subsequently, the release owner confirmed that production diagnosis was completed through a valid terminal Admin session. The findings below are supplied by that later authorized diagnosis, not a new production inspection performed while preparing this release. Applicant names, account identifiers, contact details and credentials are intentionally omitted.

Confirmed production findings from that diagnosis:
- The affected artist's application exists and its status is `approved`.
- Account linkage is correct; the linked artist profile is active.
- The listener account has role `artist`, and Artist Studio access is active.
- Admin All statuses correctly displays the approved applications.
- Pending correctly displays no applications.

The current production data for the affected artist is healthy. The historical Under Review display cannot be conclusively attributed to the stale Admin list defect. Stale client/session state on the artist's device remains a possible explanation, not a proven cause. This release fixes a real Admin reliability defect that could produce outdated/empty lists; it is not a repair of missing production applicant data and does not establish the cause of that specific historical incident. Do not approve/reject the real applicant as a diagnostic test.

The existing P0-A Admin loader already rejects HTTP failures, malformed JSON and non-array responses; those protections are retained. No current path intentionally converts a failed Applications request to `[]`. No finding from the later production diagnosis establishes historical data loss or attributes this incident to the former snapshot writer.

## 2. Lifecycle and architecture

| Stage | Routes/functions/components | Persistence/behavior |
| --- | --- | --- |
| Listener identity | `/api/auth/register/`, `/api/auth/login/`, GET `/api/auth/me/`; `mobile/src/context/AuthContext.js`, `musicApi.js` | Existing `listeners`, `auth_tokens`; account refresh supplies role and compact application. No changes. |
| Entry/status | `mobile/src/screens/ProfileScreen.js`, artist access section; `mobile/App.js` ArtistApplication route (`artist-application`) | Shows Under Review for `artist_pending` role OR latest application `pending`; therefore that label alone does not prove the row currently exists. |
| Form | `ArtistApplicationScreen.js`, `submitApplication`, `submitArtistApplication` in `musicApi.js` | Multipart photo plus existing fields; client duplicate-submit guard; refreshes account only after successful submission. No mobile edits. |
| Submit | POST `/api/artist-applications/`; `requireListener`, `applicationPayload`, `validateArtistApplication`, `validateUploadSettings`, `uploadUrlFor`, `saveDb` | Insert pending `artist_applications`; update listener role to `artist_pending` and `artist_application_id`. Upload is create-only Supabase Storage; transaction failure can leave an orphan as documented in P0-C. |
| User status | GET `/api/artist-applications/me/`; `latestApplicationForListener`, `serializeArtistApplication`; auth serializer uses `serializeCompactArtistApplication` | Latest application by numeric ID, joined in memory to account/artist. |
| Admin list | GET `/admin-api/artist-applications`; `loadDb`, `serializeArtistApplication`; `dataSources.applications`, `loadView`, `renderApplications` in `backend-js/public/index.html` | Full array, no pagination/truncation. Status/search filters and attention-first sorting. No-store response. |
| Admin detail | NEW GET `/admin-api/artist-applications/:id`; `openApplication`, `renderApplicationDetail` | Existing submitted fields, account and artist linkage, reviewed_by, projected application-specific history. No password/session hashes or unrelated audit records. |
| Approve | POST `/admin-api/artist-applications/:id/approve`; `createArtistFromApplication`, `appendAuditLog`, `saveDb` | Atomic application approval, artist insert/link, listener role/link, audit. Existing listener identity/password/session retained. |
| Reject | POST `/admin-api/artist-applications/:id/reject` | Existing rejection/review reason fields; decision metadata and audit; non-artist listener returns to listener role. No artist creation. |
| Changes | POST `/admin-api/artist-applications/:id/request-changes` | Existing `changes_requested` state/reason; applicant can submit a new application through the existing form. |
| Artist access | `ArtistStudioScreen.js`, GET `/api/artist-studio/dashboard/`, GET/POST `/api/artist-studio/releases/`, PUT `/api/artist-studio/releases/:id/`, POST `/api/artist-studio/releases/:id/submit/`, PUT `/api/artist-studio/profile/`; `requireArtist` | Requires listener role artist, linked artist, and non-suspended/non-removed artist. No Studio changes. |

Supabase load chain: server `loadDb` -> `createSupabasePersistence.loadDb` -> `queryRows` for `artist_applications`, `listeners`, `artists` and the other existing collections -> `applicationFromRow` numeric ID/date/media mapping -> server normalization and tracked baseline. Save chain: server `saveDb` -> `saveChanges` -> `applyScopedChanges` -> PostgreSQL transaction. Changed tables for review: `artist_applications`, `listeners`, `artists` (approval only), `admin_audit_logs`. No table-wide rewrite or JSON fallback was added.

## 3. Audit checklist

- Status naming: canonical application statuses are `pending`, `approved`, `rejected`, `changes_requested`. Under Review is a user-facing label for pending; release `under_review` is NOT an application status. Invalid API filters now return 400 rather than a misleading empty list.
- Filters: All uses the empty string; status and case-insensitive search combine. Search covers stage name, contact name, applicant name, account/application email and account identifier.
- Pagination: none in the existing application API. The UI filters the complete successful result, so counts distinguish genuinely empty versus filtered empty.
- Sorting: pending/changes_requested first, newest submission first within attention/reviewed groups, numeric ID as tie-breaker.
- Permissions: Applications depends only on `applications`. No users/settings/infrastructure API dependency was introduced.
- API shape: list stays an array; existing listener and review response contracts stay unchanged. New detail route adds only scoped review fields/history.
- Joins/IDs: numeric comparisons match bigint-to-number serialization. Missing account context does not filter an application out; detail says Account unavailable. Approval fails if the account is missing or linkage is invalid.
- SQL/JSON: no application status filter exists inside the Supabase raw query; all rows are read. No seed applications, fake fallback or new JSON path exists.
- Errors/loading: failed list responses never become empty state; failures retain the session except confirmed identity denial as before. Request failures render Retry; 403 renders Permission denied.
- Race/staleness: fresh read on Applications entry; explicit list/detail refresh; duplicate in-flight refreshes coalesce into one subsequent fresh read. Detail results are ignored across token/request changes. Search updates only results/counts, not the input node.

## 4. Review behavior and integrity

Approval requires a current pending/changes_requested application, an eligible non-suspended account, no already-granted artist access, and valid ownership/source linkage if an artist is already attached. Outdated applications cannot be approved after resubmission. An approved retry returns the existing result without another artist or audit entry. Concurrent approvals rely on P0-C database predicates and atomic rollback, not the browser guard: the losing transaction rolls back then re-reads the committed approved result. Other stale conflicts remain 409.

Rejection requires a nonblank reason. Approved or superseded applications cannot be rejected. An identical repeated rejection is a no-op returning the existing decision. Request-changes uses the same lifecycle boundary and existing fields. No rejection/changes operation creates an artist, resets a password, deletes an account or alters music collections. Competing approve/reject transactions commit only one decision.

The browser disables the review controls and keeps a per-application pending guard across rerenders. It asks for approval confirmation and collects rejection/changes reasons in the existing detail view. API success is followed by fresh list/detail reads; failures show an error, and 409 refreshes the detail before another review. If a response is lost, retrying approval is safe; no fake success is shown.

P0-B permissions remain unchanged. Super Admin (`*`) and Content Admin (`applications`) can list/detail/review. Moderator and Support Admin cannot. The permission matrix now includes the new detail route for every valid and invalid role. The global audit endpoint remains Super Admin-only; detail returns only existing approval/rejection/change events for that application with selected fields, not unrestricted audit access.

History consists of the actual submission timestamp, existing reviewed_at/reviewed_by/reasons, and related `admin_audit_logs` actions. The configured Admin username/role is shown exactly as recorded. There are no fabricated individual staff accounts or inferred historic decisions. Legacy records may have incomplete audit history.

## 5. User interface and responsiveness

List shows artist/stage name, applicant name/email, status, submission/update dates, genre/location, a short biography and Review action. Detail shows the existing photo, contact/profile fields, genuine-information confirmation, linkage, dates, latest review reason and history.

No applications yet, filtered empty, loading, failure and permission denial are separate states. Clear filters restores All. Refresh preserves search/status. Browser install/mobile/native settings are untouched.

Only Applications activates the compact narrow-screen horizontal Admin navigation. Other Admin pages retain their existing layout. Detail fields collapse to one column on phones; long text wraps, buttons have at least 44px height. Existing brand logo/colors remain. The sidebar's duplicate mobile refresh/logout buttons are replaced by accessible actions in Applications (other sections remain reachable in the horizontal nav).

Browser checks at 320, 360, 390, 768 and 1440px verify no horizontal page overflow, reachable review buttons, and Applications beginning within the first 400px rather than below the entire menu. Screenshots of list/detail were rendered and inspected. Actual Android/iOS hardware was not used.

## 6. Tests

Full backend suite, including opt-in browser and real PostgreSQL fixtures: **135 passed, 0 failed, 0 skipped** (118 previous + 17 new reported tests including parent groups). All P0-A, P0-B and P0-C tests remain included.

New PostgreSQL tests execute the actual server route callbacks and P0-C load/save bridge against a unique disposable local PostgreSQL 18.3 database, with synthetic media handling and account fixtures. They cover submission -> All/Pending/search/detail/status, successful/repeated/concurrent approval, rejection/reason validation, competing decisions, invalid artist linkage, outdated applications, sorting/missing-account visibility, Studio eligibility and unrelated engagement/account/catalog preservation. Permission enforcement is independently tested by the existing actual Express route/middleware matrix, extended for detail.

Browser tests run the actual Admin HTML/JavaScript in Chrome against a loopback fixture HTTP server. They cover fresh entries, loading/refresh, focused typing, combined filters, distinct errors/403, retries, detail, reason validation, duplicate actions and responsive geometry/screenshots. Browser API responses are synthetic, not production data; database tests separately verify the actual handlers. A VM loader test covers refresh during an older in-flight read.

Run from `backend-js`, with an isolated loopback PostgreSQL instance already running:

```powershell
$env:TESO_P0C_POSTGRES_PORT = '55483'
$env:TESO_AUDIO_PGLITE_MODULE = "$env:TEMP\tesohub-audio-audit-tools\node_modules\@electric-sql\pglite\dist\index.js"
$env:TESO_PLAYWRIGHT_MODULE = "$env:TEMP\tesohub-profile-test-tools\node_modules\playwright\index.mjs"
node --test --test-reporter=tap tests/*.test.js
```

Optional `TESO_APPLICATION_SCREENSHOTS` sets a local screenshot directory. The tests never use production DATABASE_URL. Test databases are dropped; the isolated local cluster is stopped after verification. Syntax, git whitespace and secret-pattern checks pass. Security/persistence modules and configuration remain unchanged.

## 7. Files changed

1. `backend-js/server.js`: application list/search/sort, authorized detail/history, lifecycle and idempotent approval handling.
2. `backend-js/public/index.html`: Applications-only list/detail/refresh/search/review/responsive behavior and explicit permission label.
3. `backend-js/tests/admin-loading.test.js`: distinct empty assertion and in-flight refresh regression.
4. `backend-js/tests/admin-permissions.test.js`: existing policy matrix extended to the new application detail route.
5. `backend-js/tests/artist-applications.test.js`: new actual-handler/PostgreSQL workflow tests.
6. `backend-js/tests/artist-applications-browser.test.js`: new real-browser UI/responsive tests.
7. `ARTIST_APPLICATIONS_REVIEW_2026-10-08.md`: this audit/report.

## 8. Release boundary and remaining limitations

- Schema/migration changes: **NO**. Production data changes by this release preparation: **NO**. No real application was approved or rejected by this work.
- Implementation was validated locally; the release owner has authorized a controlled commit/push after the final gates. Push/deployment status is reported separately. No OTA/APK/native work, no staging work, no whole-Console redesign.
- Deployment risk: **moderate**, scoped to application review and Admin presentation. Release backend and its served Admin HTML together; retain P0-A/B/C guards and scoped persistence.
- Later authorized production diagnosis confirms healthy approved application/account/artist linkage and active Studio access. The specific historical device display's cause remains unresolved; stale client/session state is possible. No reconstruction or data repair is warranted by these findings.
- List/detail retain the existing full-snapshot read cost; no pagination or realtime service was added. Refresh/re-entry fetches new data, not continuous polling.
- Existing configured Admin identity is shared; audit records cannot identify an individual operator beyond that model.
- Existing JSON mode does not gain PostgreSQL multi-process guarantees. Production remains Supabase authoritative; this work does not change persistence configuration.
- No ETag/browser form-version system was added; P0-C server-read-to-write conflict protection remains. No orphan-media cleanup system was added.

After the approved release push, stop for production verification. Do not mutate real applications as part of release preparation.
