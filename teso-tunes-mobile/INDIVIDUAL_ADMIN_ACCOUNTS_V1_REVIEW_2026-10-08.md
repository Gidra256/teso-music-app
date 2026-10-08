# Individual Admin Accounts V1 - Local Review

Status: RECONCILED LOCALLY; NOT COMMITTED OR DEPLOYED. Stop for approval.
Branch: `codex/individual-admin-reconciled`.
Base/HEAD: `5e2ee8f1306270991f23f1ba593228de22b17e15` (engagement-count fix).
The original reviewed implementation and historical test evidence follow below.
Section 26 records the fresh 2026-10-09 reconciliation and final local test gate.
Original checkout and previous committed work are preserved. No production
credentials were needed or used. All account mutations were disposable local fixtures.

## 1. Existing Authentication Audit

Before this change, POST `/admin-api/login` compared `username`/`password` against
one environment identity and returned `ADMIN_TOKEN` to JavaScript. The Console
stored it under `tesoAdminToken` in localStorage and sent Authorization: Bearer
on Admin API/attachment requests. GET `/admin-api/me` checked that bearer through
`requireAdminPermission` and returned one `publicAdminUser`. `ADMIN_ROLE` resolved
an exact supported role, failing closed when invalid; the P0-B role map supplied
all permissions. Permanent deletion and infrastructure routes required `*`.

`/admin-api/me` also issued a 15-minute HttpOnly/SameSite=Strict `/api/` preview
cookie signed using the shared token. Native audio controls used that cookie;
`audioAccessFor` also accepted the shared bearer or normal artist/listener bearer.
The Console's old Logout deleted the preview cookie and localStorage, but did not
revoke the shared bearer. `/admin-api/users/:id/revoke-sessions` revoked listener
sessions, not staff sessions. There were no persistent staff records or individual
Admin session records. Rotating the environment token was the practical shared
credential invalidation mechanism.

Single-identity assumptions: login comparison, `publicAdminUser`, Admin permission
middleware, audio cookie signing/validation, frontend localStorage/Authorization,
support reply authors, application/release `reviewed_by`, platform `updated_by`,
and audit `admin_user` fallbacks to the configured username. `publicAdminUser`
remains a legacy role-projection helper for regression tests; runtime authentication
now uses the dedicated identity resolver, not that helper. Audit attribution flows
through the resolved `req.adminUser.username` instead of inventing staff identities.

Environment names involved (no values): `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
`ADMIN_TOKEN`, `ADMIN_ROLE`; existing database/storage configuration includes
`PERSISTENCE_BACKEND`, `DATA_BACKEND`, `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and existing bucket variables.
`SCHEDULED_PUBLISHER_ENABLED` is unrelated to authentication and remains untouched.
The old hard-coded fallback recovery password was removed. A missing
`ADMIN_PASSWORD` disables browser recovery-password login, not the bearer recovery
path. A missing `ADMIN_TOKEN` retains the existing random-per-process behavior;
an explicitly configured secret is necessary for stable operator recovery.

## 2. Individual Architecture

`backend-js/adminAccounts.js` owns staff credentials, sessions, throttling and
security mutations. It uses the existing reusable PostgreSQL pool through the
small `getAdminPool` accessor. No second connection pool, listener-table overload,
JSON fallback, whole-database snapshot write, auth provider or paid service.
Security transactions revalidate sessions using their already-acquired connection,
including under a one-connection pool. Guests and bearer recovery do not query
staff session tables unless a database-backed session cookie must be resolved.

Admin identity middleware resolves either a persistent session or explicit
Super Admin break-glass bearer. Existing route guards still apply the unchanged
P0-B role map. Account mutations use scoped SQL transactions; they never enter
the music DTO or maintenance-import path. Existing listener authentication stays
unchanged.

## 3. Migration Details

Prepared locally: `backend-js/migrations/006_individual_admin_accounts.sql`.
Applied ONLY to disposable local test databases; no production migration.

Three new tables in `tesohub_music`:

| Table | Columns |
| --- | --- |
| `admin_accounts` | identity bigint `id`; `display_name`; normalized unique `login_identifier`; `password_hash`; exact `role`; boolean `active`; `created_at`, `updated_at`, nullable `last_login_at` |
| `admin_sessions` | SHA-256 `token_hash` primary key; nullable `admin_id`; `break_glass`; nullable `recovery_key_hash`; unique nullable `preview_hash`; nullable `preview_expires_at`; `created_at`; `expires_at` |
| `admin_login_limits` | hashed `key_hash` primary key; integer `attempts`; `window_start` |

Constraints: names 2-100 trimmed characters; login 3-120 lowercase characters from
the documented identifier alphabet, normalized at the API and enforced in SQL;
case-insensitive uniqueness through canonical storage; exact four-role check;
scrypt-tagged hash; session hashes length 64; session account/recovery exclusivity;
expiration after creation. `admin_sessions.admin_id` references `admin_accounts.id`
with ON DELETE RESTRICT. No account delete endpoint. No foreign keys to listeners.
Existing polymorphic audit history is not rewritten or given misleading new FKs.

Indexes: primary/unique indexes; active-account role lookup; session account;
session expiry; login-limit window age. RLS enabled on all three tables with a
restrictive deny-all PUBLIC policy per table and no permissive client policies.
All table/identity-sequence privileges are revoked from PUBLIC and from
anon/authenticated/service_role when those roles exist. The backend SQL owner keeps
access. Effective client privilege assertions abort on unsafe inherited grants.

The migration is explicit, transactional and one-time, not silently rerunnable.
No existing music table/column changes. Keep new tables after a code rollback;
dropping them would destroy staff credentials/sessions. Prefer fix-forward.
Database backups must include these tables. Existing music JSON exports do NOT
include staff password/session tables; do not treat those exports as staff backups.

## 4. Login and Session Design

POST `/admin-api/login`: individual identifier/password -> opaque random session
in Secure, HttpOnly, SameSite=Strict cookie `tesohub_admin_session`, path
`/admin-api`, maximum age eight hours. No session token returned in JSON or saved
in browser storage. Stored session credential is SHA-256 of 32 random bytes.
Session role/active state is joined from the current account for every request.
No frontend role is trusted, including forged headers/body fields.

Console removes obsolete `tesoAdminToken` localStorage. Its internal `state.token`
name now means only a non-secret request generation for stale-response protection;
it is never an Authorization credential. API fetches use same-origin cookies.
Password inputs clear when submitted and are never saved locally or logged.

Cookie-authenticated mutations and login require `X-Teso-Admin: 1`. Cross-site
Fetch Metadata and mismatched Origin are rejected. Recovery API bearers remain
usable from an authorized terminal without a CSRF header. JSON-only login/reset
inputs and same-origin cookies avoid accepting cross-origin HTML form submissions.
All new cookie flags are Secure even in development: use HTTPS or a browser's
loopback secure-cookie allowance. No production switch weakens cookie security.

## 5. Password Security

Async Node `crypto.scrypt`, random 16-byte salt, N=32768/r=8/p=3, 64-byte output,
timing-safe comparison. This is an OWASP-listed scrypt parameter set with about
32 MiB working memory per derivation. At most two derivations run concurrently
per process; excess work receives retryable 429, not unbounded memory growth.
Unknown users also incur a dummy scrypt derivation. Malformed stored hashes fail
closed. No custom cipher, no plaintext password persistence, no added dependency.

New passwords/passphrases require 15-128 characters, reject whitespace-only,
single-character repetition and a small obvious-password denylist. No arbitrary
symbol-composition rule. This is not a breached-password database or MFA.
Existing listener PBKDF2 credentials were NOT changed or migrated.

References: [Node crypto.scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback),
[OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).

## 6. Roles and Permissions

The P0-B permission arrays and existing route guards are unchanged:
- `super_admin`: `*`.
- `content_admin`: applications, artists, catalog, discovery, genres, releases.
- `moderator`: reports, users, artists, catalog.
- `support_admin`: support:view, support:reply, support:note, support:update.

Only Super Admin can list/create/manage staff, reset others' passwords or revoke
others' sessions. All four roles may change their own password. Role/status changes
delete the target's sessions transactionally. A fresh login uses the new role;
reactivation does not revive old sessions. A stale access form receives 409.

## 7. Final Super Admin

Every security write obtains the same PostgreSQL transaction advisory lock and
re-resolves the acting identity. Under that lock, disabling/demoting the final
active individual Super Admin is rejected with 409. Independent-connection tests
confirm two concurrent requests cannot remove both remaining owners. Break-glass
does not count as a substitute owner when evaluating this safeguard. No delete
action exists, and there is no API to remove the environment recovery secret.

## 8. Break-Glass

Existing environment bearer remains available, but ONLY when `ADMIN_ROLE` is
exactly `super_admin`. It resolves to `break-glass:environment`, never a fake named
staff member. Existing lower-role environment credentials no longer serve as
normal staff logins. Invalid configuration denies recovery; it does not prevent
valid individual database accounts from authenticating.

The separate emergency checkbox calls POST `/admin-api/break-glass-login` with
explicitly configured environment username/password. It returns a revocable
HttpOnly session, never the environment token. Bearer recovery still permits
`/admin-api/me` and protected recovery operations if browser sessions fail.
Actual account recovery still requires a working database.

Do NOT retire it in this release. After individual owners and lower-role access
are proven stable, use a separate approved recovery-retirement/rotation plan,
retaining an independently tested recovery method before disabling legacy access.

## 9. Management UI

Admin Management appears only for Super Admin. It lists display name, identifier,
exact role, effective permissions, Active/Disabled, created date and last login.
Add Admin defaults to Support Admin, not Super Admin. Access changes, password
resets and session revocation require confirmation and prevent duplicate submits.
No credential hashes or session identifiers are displayed. No broad Console redesign.
The sidebar shows the current display name/role and Logout. Account Security lets
each individual staff member change their own password.

## 10. Password Change / Reset

POST `/admin-api/change-password` requires the current password and a valid new
password. Super Admin can POST `/admin-api/admin-accounts/:id/reset-password` with
a new password through the masked input. Both update the hash and invalidate ALL
target sessions/preview access in one transaction. No email is sent. Operators
must deliver initial/reset credentials through a separately secured channel,
not chat or email in plaintext. V1 does not provide forced-first-login reset links.

## 11. Audit Identity

Individual identities carry stable `admin:<id>:<login_identifier>` labels through
existing `admin_user`, support author, reviewed_by and updated_by fields. Display
name remains separately available in `/me` and Admin Management. New security
events include actor ID/auth type in existing audit JSON details. No old event is
rewritten. Break-glass uses `break-glass:environment`; failed logins use
`security:login` plus a hashed identifier, never an asserted staff identity.

Create/bootstrap, login/denial/logout, role/status changes, password changes/reset
and session revocation are audited. Added previously missing migration-initiation
and persistence-export audit events; exports do not include new staff credentials.
Existing music/application/release mutations continue their P0-C audited writes.
The authoritative follow/like transaction from the current master is unchanged.

## 12. Private Audio / Release Review

Audio middleware resolves staff identity without changing P0-A publication/ownership
checks, Range streaming or Storage policy. Individual `/me` issues a random
15-minute HttpOnly/Secure/SameSite preview capability stored hashed on the parent
session. Preview requests re-check session expiry and the current account role and
status. Logout, expiry, reset, disable, downgrade and revoke remove preview access.
Content Admin can review private releases; Support Admin cannot. Moderator retains
catalog privileges but does not gain release preview. Real role/session behavior
is tested alongside the unchanged downstream P0-A authorization/streaming matrix.

Legacy terminal-bearer preview retains the existing signed, short-lived cookie for
compatibility. A copied legacy recovery bearer or signed legacy preview cookie
cannot be individually revoked through normal staff logout: the bearer requires
environment-secret rotation, and the legacy preview expires after fifteen minutes.
Normal and browser recovery sessions do not have this limitation.

## 13. Failed Login Protection

Generic wrong/unknown/disabled responses. PostgreSQL-backed 15-minute windows:
10 attempts per hashed login, 30 per hashed network address in each authentication
realm (individual or recovery). A successful committed login clears only its
account counter, never the source budget. Failures and successful logins both consume
source budget, preserving protection against credential spraying. Individual login
traffic cannot consume recovery's budget. Limits span backend instances. Old limiter
rows are removed after one day before checking login limits. Windows reset after
15 minutes; blocked attempts do not extend them. Login KDF concurrency is bounded.
Rate-limited requests return generic 429. No passwords, raw IPs or raw session
tokens are stored in security logs. Existing `trust proxy` behavior was not globally
changed; the limiter uses the rightmost forwarded hop instead of the untrusted
leftmost value. Confirm Render's append/strip behavior in production before rollout.

## 14. Bootstrap

No default account or manufactured password. Authenticated break-glass Super Admin
opens Admin Management and explicitly creates the owner with chosen credentials.
POST `/admin-api/admin-accounts/bootstrap` is also available to authorized recovery
terminal sessions without putting credentials in chat. It requires an explicit
`role: super_admin` (missing or other roles are rejected, never promoted),
requires no existing individual accounts and runs under the security lock. A second
bootstrap is denied. Once created, sign in as the owner for ordinary account creation.
Break-glass can reset/reactivate existing owners if needed, not create ordinary staff.

## 15. Migration / Rollout Plan (Not Executed)

1. Review this diff, security tests, migration and limitations. Recheck latest master
   before any later approved release; do not overwrite newer security work.
2. Back up PostgreSQL securely, verify recovery credentials out of band, keep
   `ADMIN_ROLE=super_admin` and `SCHEDULED_PUBLISHER_ENABLED=false`.
3. Apply ONLY migration 006 after explicit approval, with the privileged database
   operator. Verify all three tables/constraints/indexes/RLS/grants. Do not rerun
   prior catalog migrations. The current backend ignores these additive tables.
4. Deploy the approved backend/Admin code with recovery preserved; verify health,
   HTTPS/proxy behavior, P0-A/B/C, Applications, Review and disabled publisher.
5. Use authenticated break-glass recovery to bootstrap the owner's individual account.
   No credentials in chat, command-line history, committed files or reports.
6. Log in as that owner. Verify all high-risk workflows with safe fixtures/read-only
   checks, logout/revocation and correct individual audit attribution.
7. Create one authorized disposable lower-role Admin; verify permission denial and
   intended workflows, then disable it/revoke sessions per the approved cleanup plan.
8. Move normal operations to individual identities. Keep break-glass outside daily use.
   Do not enable scheduled publishing. No mobile/PWA/OTA/APK change is required.

If rollout fails, keep new records and audit history, keep recovery secret protected,
and fix forward. Do not restore an old full database snapshot over staff/accounts
or music data. Do not drop new tables or weaken P0-A/B/C to recover login.

## 16. Tests Added / Adapted

`admin-accounts.test.js`: real disposable PostgreSQL plus HTTP/browser tests for
KDF/hash handling, generic denials, Secure/HttpOnly cookies, logout/expiry, exact
four-role matrix, forged role rejection, account CRUD/security boundaries,
duplicate/invalid identifiers, downgrade/disable/reactivation, preview revocation,
same-origin protection, throttling, one-time bootstrap, concurrent final-owner
protection, password reset/change, stable audit attribution, RLS, stale forms and
session survival across service recreation, database-independent guest/recovery
identity resolution and concurrent security requests with a one-connection pool.
Chrome runs real cookie login,
bootstrap, staff creation, role change, password change/logout and management at
320/390/768/1440 widths with no horizontal overflow. Screenshots inspected locally.

Existing permission and audio harnesses now supply a resolved synthetic principal
for their downstream matrices; real credential resolution is covered by the new
PostgreSQL/HTTP tests. Existing route permission expectations remain unchanged.
The loader tests assert non-secret client session state instead of localStorage.

## 17. Final Validation

- Backend/Admin ACL-hardening gate: 214 passed, 0 failed, 0 skipped (including parent test groups; implementation baseline was 196, previous readiness gate 208).
- Listener/mobile: 46 passed, 0 failed, 0 skipped.
- P0-A/B/C, Artist Applications, Release Review and scheduled flag regressions: PASS.
- Real browser security/management flow and four responsive widths: PASS.
- Syntax, diff and secret-pattern scans: PASS; zero secret-pattern findings.
- No mobile source/dependency/native configuration changed; no new exports/APK needed.
- No production traffic, production account creation or production migrations.

## 18. Files

- `backend-js/adminAccounts.js` (new)
- `backend-js/migrations/006_individual_admin_accounts.sql` (new)
- `backend-js/server.js`
- `backend-js/supabasePersistence.js` (existing pool accessor only)
- `backend-js/public/index.html`
- `backend-js/tests/admin-accounts.test.js` (new)
- `backend-js/tests/admin-loading.test.js`
- `backend-js/tests/admin-permissions.test.js`
- `backend-js/tests/audio-access.test.js`
- `INDIVIDUAL_ADMIN_ACCOUNTS_V1_REVIEW_2026-10-08.md` (this report)

## 19. Schema Changes

YES, one additive local migration prepared/tested. NOT applied to production.

## 20. Production Data

NO production changes, accounts or media touched. Disposable local databases only.

## 21. Deployment Risk

Moderate/high: privileged authentication boundary changes require deliberate
migration-first rollout and independent review. Existing Console sessions will be
signed out because localStorage bearer use is removed. Validate owner recovery,
HTTPS cookies, proxy rate-limit behavior and migration permissions before release.
Default-off scheduled publication is unchanged and must stay false.

## 22. Remaining Limitations

- No MFA, email delivery, setup links, breached-password lookup or SSO in V1.
- Initial/reset passwords are operator-managed; use a secure out-of-band channel
  and ask recipients to change their password. No forced-change policy in this V1.
- Legacy bearer recovery is intentionally not retired; rotation/restart is still
  needed to revoke it. Legacy copied preview capabilities expire rather than being
  individually revocable. Browser recovery uses the new revocable mechanism.
- Absolute eight-hour sessions, no separate idle timeout or per-session list UI.
- Revocation stops subsequent authorization; already authorized in-flight requests
  or bytes already buffered by a player cannot be retroactively cancelled.
- Login throttling can temporarily inconvenience a targeted account. Authorized
  bearer recovery is a separate path; verify trusted proxy behavior before deployment.
- Account operations have cross-process safety locks; direct privileged SQL remains
  operator responsibility. There is no independent trigger blocking DBA changes.
- Staff tables require database backup coverage, outside old music JSON exports.
- No production or physical-device verification performed in this local task.

## 23. Boundary

NOTHING DEPLOYED. No push/commit, production migration, real staff account,
production data mutation, publisher enablement, native change, APK or OTA.
No monetization or unrelated Admin redesign. Stop for review/approval.

## 24. Final Production-Readiness Gate

### Evidence Boundary

Reviewed against the versioned production schema contracts in migrations 001, 004
and 005 and the deployed-baseline source at
`b963f5e68f4bf56a83c649b2a18e3dc758f779d4`. All three schema migrations were replayed
in a disposable local PostgreSQL database before 006. No live database connection,
production credentials, remote schema dump or production writes were used in this
gate. Therefore unrecorded production schema/ACL drift is NOT independently ruled
out. Operator metadata verification remains a pre-migration requirement, not a
claim that production was audited through a live SQL session.

### Migration Safety and Public Exposure

006 adds three tables and their constraints/indexes, with one account FK and no
catalog/listener/release writes. Staff operations use dedicated SQL transactions
and do not enter P0-C snapshot/scoped music persistence. Duplicate execution is
safe but intentionally NOT a successful no-op: CREATE reports duplicate-table,
the transaction is aborted and existing staff/accounts/sessions/audits remain
unchanged. Do not substitute blind IF NOT EXISTS or execute statements separately.

Real PostgreSQL tests injected a halfway error and proved all new tables rolled
back. They also granted permissive default table/sequence privileges to anon and
authenticated before migration: 006 removed access; reads, deletes and sequence
use were denied. All three tables have RLS enabled; section 25 adds explicit
restrictive deny policies and extends the privilege tests to service_role/PUBLIC.
Nine expected indexes exist and an orphan session fails its FK. No public/listener
serializer or catalog export includes these tables. Trusted PostgreSQL owner
access remains intentional and must never be given to a browser. Supabase
service_role has NO access to these Admin objects, as hardened in section 25.

### Passwords, Cookies and Recovery

Only salted scrypt hashes reach SQL. Application login/reset handlers neither log
request bodies nor return SQL errors, hashes, salts or session tokens in JSON.
Audit stores actions/identity, not passwords. Account responses have an explicit
operational-field allowlist. Full privileged database backups necessarily contain
hashes; protect them. Infrastructure request-body/bind-parameter debug logging
must remain disabled; this local audit cannot attest to external log settings.
Scrypt N=32768/r=8/p=3 is one of the documented OWASP alternatives; comparisons use
Node's timingSafeEqual. No custom password cipher is introduced.

Local HTTPS-proxy tests preserved Host and forwarded HTTPS protocol while the
backend socket was HTTP. Same-origin login/logout passed; mismatched Origin was
denied. The main cookie is Secure/HttpOnly/Strict, path /admin-api, eight hours;
preview is Secure/HttpOnly/Strict, path /api/, at most fifteen minutes and never
beyond its parent server-side expiry. Real Chrome verified JavaScript cannot read
either cookie. Production proxy/header/browser checks remain rollout smoke tests.
The legacy global trust-proxy configuration was not broadened by this work.

Environment bearer recovery /me works before 006, before owner creation, after
owner creation, and after individual-session revocation. Before 006, NEW browser
recovery sessions deliberately return 503 with no cookie: they require the new
session tables. Keep the existing protected bearer available during migration.
After migration, browser recovery is fully session-backed and revocable. Recovery
actions are distinctly attributed to break-glass:environment. Legacy bearer and
legacy signed preview limitations in section 12 remain; do not represent legacy
bearer logout as revocation of the environment secret.

### Bootstrap, Concurrency and Permissions

Bootstrap requires authenticated recovery with explicit super_admin and no existing
individual accounts. Two concurrent requests create exactly one owner (201/409).
Audit-write failure rolls the owner creation back, leaves no account, and permits
a clean retry (sequence numbers may have gaps, which is expected PostgreSQL behavior).
Unauthenticated, lower-role, individual-super and duplicate bootstrap attempts fail.

Independent-connection security transactions cannot disable/demote both remaining
owners; one wins and one gets 409. With a second owner, legitimate demotion works.
Password/session operations leave the recovery owner active. Role downgrade,
disable, password reset/change and revocation invalidate existing sessions and
linked private-preview capabilities. Permissions are reloaded from SQL each request.
Forged client roles are ignored. Content Admin keeps Release Review and authorized
preview; Support Admin is denied private preview. P0-B permissions and scheduled
publisher implementation are unchanged. Missing/false publisher flags remain off;
the production flag must stay false and was not changed or read in this task.

### Files Changed by This Gate Only

- backend-js/adminAccounts.js: explicit bootstrap role; successful account-counter
  reset; separate recovery realm and pre-check stale-limit cleanup.
- backend-js/public/index.html: explicit bootstrap role field only.
- backend-js/migrations/006_individual_admin_accounts.sql: sequence ACL revocations
  and explicit one-shot/atomic migration comment.
- backend-js/tests/admin-accounts.test.js: twelve additional readiness cases and
  stricter identity/owner checks; actual Host-preserving proxy request harness.
- This review document: corrected behavior, expanded evidence and recovery runbook.

No production schema/data, native/mobile configuration, publisher or unrelated UI
was changed. Existing ten-file implementation inventory remains section 18.

### Exact Rollout Sequence (Approval Required; Not Executed)

1. Fetch/review latest master and preserve all P0-A/B/C, Applications and Release
   Review work. Resolve no security conflicts silently. Recheck approved inventory,
   tests, syntax, diff and secret scan before any approved commit/push.
2. Take a protected database backup including staff tables if they already exist.
   Verify existing recovery /admin-api/me securely, without printing credentials.
   Confirm ADMIN_ROLE explicitly super_admin and SCHEDULED_PUBLISHER_ENABLED=false;
   do not rotate/remove recovery during this transition.
3. Through the authorized database operator, read pg_catalog metadata: confirm
   tesohub_music and admin_audit_logs match migration 001's contract; inspect any
   pre-existing admin_accounts/admin_sessions/admin_login_limits objects, indexes,
   policies, role memberships and grants. If any 006 objects already exist or schema
   differs, STOP and reconcile metadata; never drop or blindly recreate them.
4. Apply ONLY 006 in one connection using the approved secure DB connection setup:
   `psql -X --set=ON_ERROR_STOP=1 --file=backend-js/migrations/006_individual_admin_accounts.sql`.
   Do not put a connection URI/password on the command line. Do not rerun 001/004/005.
   Verify table/constraint/index/RLS/ACL metadata including identity-sequence grants.
5. Deploy only the approved backend/Admin release. Check /healthz, recovery /me,
   publisher disabled, public Range playback and existing application/release lists.
   Verify HTTPS cookies and trusted forwarded-address handling on Render before
   onboarding staff. Do not mutate real releases for verification.
6. Bootstrap the first owner once through authenticated recovery, with explicit
   super_admin and an out-of-band strong password. If response is lost, list accounts
   through recovery before retrying. Sign in as owner; verify identity/audit attribution,
   logout/revocation and authorized review with an approved safe fixture.
7. Only after owner login/recovery succeed, transition staff; validate a disposable
   approved lower-role account and disable/revoke it according to the cleanup plan.
   Leave the publisher false and all new staff tables/records intact.

### Exact Recovery / Fix-Forward Sequence

A. Migration succeeded, new login fails: stop staff onboarding; retain all three
tables and audit history. Use protected environment bearer /me to establish recovery.
Check table metadata, backend DB access and sanitized HTTP status/error category.
Repair the specific login/configuration issue in a reviewed fix-forward release;
retest before enabling staff use. Never rerun old imports or expose password hashes.

B. Migration fails halfway: with ON_ERROR_STOP and a single transaction, disconnect
or ROLLBACK that session. Confirm none of the new objects committed; existing data
must be unchanged. Correct the cause on a disposable database, then reapply the whole
006 only after confirming absence. If an operator ran pieces outside the transaction,
STOP for an additive reconciliation plan; do not automatically drop unknown objects.

C. Individual sessions fail behind Render: retain Secure/HttpOnly/Strict. Use bearer
recovery outside the broken browser path; inspect redacted Set-Cookie attributes,
Host/Origin/protocol handling and path/expiry, never cookie values. Confirm the public
HTTPS origin and proxy forwarding, then fix only the verified cause. Do not disable
CSRF or weaken cookie flags to get login working.

D. Admin UI regression: keep backend authorization and staff tables. Use authorized
recovery for essential operations and fix forward the narrow UI fault, then rerun
browser regressions. Do not roll back to a legacy UI that expects raw bearer tokens
from the new login endpoint. Any exceptional code rollback needs a separately reviewed
compatible backend/UI pair preserving P0-A/B/C and Release Review; never restore an
older unprotected security implementation or revert the database wholesale.

E. Bootstrap fails: check account list via recovery before retrying. If empty after
rollback, repair the cause and retry explicit-super bootstrap once. If the owner
exists after a lost response, bootstrap is closed correctly: use recovery reset or
reactivation of that owner, not a second bootstrap or direct deletion. Verify owner
login and audit before resuming. Do not reset identity sequences to hide harmless gaps.

### Readiness and Residual Risk

Previous local readiness gate: 208 backend/Admin, 46 listener/mobile; zero failures/skips.
The subsequent ACL-hardening gate is documented in section 25.
P0-A/B/C, Artist Applications, Release Review, native adapters/web regressions and
browser management widths 320/390/768/1440 pass. Syntax, secret-pattern and diff
checks pass. No APK/export/native work is necessary for these Admin-only changes.
Ready for controlled rollout approval, conditional on the explicit live metadata
and proxy smoke checks above; not an assertion that an undeployed release is verified
on production. Authentication rollout risk remains moderate/high despite green tests.
Nothing committed, pushed, deployed or applied to production. Stop for approval.

References: OWASP Password Storage Cheat Sheet (scrypt alternatives)
https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt
and Render's TLS termination documentation https://render.com/docs/tls .

## 25. Hostile Default ACL Hardening (Local Only)

### Exact Target Schema

Every new object is in `tesohub_music`, independently of the connection search_path:

- Tables: admin_accounts, admin_sessions, admin_login_limits.
- Identity sequence: admin_accounts_id_seq, owned by admin_accounts.id.
- Explicit indexes: admin_accounts_active_role, admin_sessions_account,
  admin_sessions_expiry, admin_login_limits_age.
- Constraint indexes: admin_accounts_pkey, admin_accounts_login_identifier_key,
  admin_sessions_pkey, admin_sessions_preview_hash_key, admin_login_limits_pkey.
- Restrictive policies attached to their respective tables:
  admin_accounts_client_deny, admin_sessions_client_deny, admin_login_limits_client_deny.
  Policies are table-scoped objects, not independent schema objects.

PostgreSQL places an index in its parent table's schema even when the index name
itself is unqualified. No object is created in public. The pre-existing-sequence
guard prevents PostgreSQL from silently choosing a different identity-sequence
name and leaving the actual sequence outside the explicit ACL revocations.

The reported public-schema findings do not establish the target schema's defaults.
Defaults scoped specifically to public do NOT apply to tesohub_music. Global
defaults (defaclnamespace=0) DO apply, and schema-specific defaults are additive.
Both are scoped to the role executing CREATE, not simply the connection search_path.
The next metadata query below includes global and tesohub_music defaults for ALL
creator roles; use the actual migration executor's rows when reviewing the result.

### Security Finding and Fix

YES: the earlier migration already revoked PUBLIC/anon/authenticated table and
sequence access, but did not remove service_role's potential automatic grants.
A service_role with BYPASSRLS could read through such grants. This was a migration
hardening gap; it is NOT evidence that production Admin data has been exposed:
006 has not been applied by this task and live target-schema metadata is pending.

The backend staff module uses the PostgreSQL pool and does not use Supabase REST
service-role access to these tables. Therefore service_role receives NO staff-table
or sequence privileges. The migration does not change its role attributes, Storage
permissions, other tables or database-wide default privileges. The trusted database
owner retains implicit access. A deployment using an unrelated non-owner SQL role
must be reviewed explicitly; this migration does not invent an allow policy for it.

Protections, all inside BEGIN/COMMIT:

1. Reject execution as anon/authenticated/service_role before any CREATE.
2. Reject a pre-existing expected identity sequence without the accounts table.
3. Enable RLS on each of the three tables (already present).
4. Add AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false) per table.
5. REVOKE ALL on the three tables and the identity sequence from PUBLIC and,
   conditionally, anon/authenticated/service_role. No global default ACL is edited.
6. Check effective SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
   and sequence USAGE/SELECT/UPDATE for the three API roles. Abort the transaction
   if inherited grants still confer any access; do not alter unrelated group roles.

Restrictive policies deny ordinary clients even if a later accidental DML grant
and permissive policy are added. RLS is NOT a defense against superusers or
BYPASSRLS roles, and does not protect TRUNCATE, REFERENCES or sequence operations.
Those require ACL discipline; restoring grants to service_role later is unsafe.
FORCE RLS is deliberately not used because the backend database owner must work.
Do not confuse an RLS policy TO PUBLIC denying rows with an access grant to PUBLIC.

### Hostile-Default Tests

Before 006, disposable PostgreSQL tests grant ALL table and sequence privileges
both globally and in tesohub_music to PUBLIC, anon, authenticated and service_role.
The service-role fixture has BYPASSRLS. After migration:

| Principal | Table privileges | Sequence privileges |
| --- | --- | --- |
| PUBLIC (ACL inspection + unprivileged probe role) | none | none |
| anon | none | none |
| authenticated | none | none |
| service_role | none | none |

Tests assert every requested privilege separately (plus MAINTAIN), actual SQL
read/delete/sequence denial, no PUBLIC ACL entries, and normal Admin handlers still
working. Additional tests grant clients DML access and a permissive policy inside
a rolled-back local transaction: SELECT returns zero rows, UPDATE/DELETE affect
zero rows, and INSERT is denied by RLS for all three tables.

A separate non-superuser, non-BYPASSRLS database-owner fixture applies 006 and
successfully inserts/reads/updates/deletes staff records, sessions and throttles,
including generated identity values. Further fixtures prove that a failing REVOKE
rolls back all new objects/policies; an inherited privilege aborts at the final
assertion; API-role executors cannot run 006; an existing identity sequence keeps
its ACL unchanged with no suffixed sequence created. Duplicate/partial-migration,
authentication, security concurrency, P0-A/B/C and Release Review regressions remain.

Final totals: Backend/Admin 214 passed, 0 failed, 0 skipped. Listener/mobile 46
passed, 0 failed, 0 skipped. Syntax, secret-pattern scan and git diff --check pass.
Local PostgreSQL is 18; reported production version is 17.6. Used SQL/ACL/RLS
features are supported in PostgreSQL 17; this is not a live 17.6 execution claim.

Files changed in this follow-up ONLY: migration 006, admin-accounts.test.js, and
this report. All previous working files remain preserved. No backend runtime,
Admin UI, mobile or publisher change in this follow-up.

### Next Read-Only Supabase Query

Run this in the authorized Supabase SQL editor. It reads only catalog metadata,
not user data, credentials or session values. It includes global defaults because
filtering only by the target schema would miss automatically inherited grants.

```sql
select
  pg_get_userbyid(d.defaclrole) as creator_role,
  case when d.defaclnamespace = 0 then 'GLOBAL (all schemas)'
       else n.nspname end as default_scope,
  case d.defaclobjtype when 'r' then 'TABLE'
                      when 'S' then 'SEQUENCE' end as object_type,
  case when a.grantee = 0 then 'PUBLIC'
       else pg_get_userbyid(a.grantee) end as grantee,
  a.privilege_type,
  a.is_grantable
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) a
where d.defaclobjtype in ('r', 'S')
  and (d.defaclnamespace = 0 or n.nspname = 'tesohub_music')
order by creator_role, default_scope, object_type, grantee, privilege_type;
```

Zero rows means no matching explicit default-ACL entries, not a complete live
security sign-off. Existing-object collisions, actual backend owner/membership,
schema ACLs and proxy compatibility still belong to the live preflight. No database
credentials are requested. Migration 006 is hardened against the reported automatic
table/sequence grants: it either reaches the tested secured state or rolls back on
unsafe effective API privileges. This does not authorize production execution.

Production schema changed: NO. Production data changed: NO. Code pushed: NO.
Code deployed: NO. No production requests in this follow-up. Stop for review.

PostgreSQL 17 references:
https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html
https://www.postgresql.org/docs/17/ddl-rowsecurity.html

## 26. Current-Master Reconciliation - 2026-10-09

### Source and Scope

Fetched origin/master: `5e2ee8f1306270991f23f1ba593228de22b17e15`.
This is also the new branch HEAD and contains the approved engagement fix.
Fresh isolated branch: `codex/individual-admin-reconciled`.
No merge of the paused feature branch, no rebasing of its working files, and no
commit/push/deployment. Only the ten reviewed Admin files were carried over.
The original checkout, paused Individual Admin worktree, and engagement release
worktree remain preserved. No semantic reconciliation conflicts were found.

Exact inventory, relative to teso-tunes-mobile:

| File | Scope |
| --- | --- |
| backend-js/adminAccounts.js | Added dedicated account/session/authentication runtime |
| backend-js/server.js | Admin integration, resolved identities, audits and preview integration |
| backend-js/supabasePersistence.js | One-line getAdminPool accessor to the existing pool |
| backend-js/public/index.html | Admin login, management and own-password UI |
| backend-js/migrations/006_individual_admin_accounts.sql | Reviewed, additive, transactional migration; disposable local tests ONLY |
| backend-js/tests/admin-accounts.test.js | Reviewed individual-account/ACL/browser/concurrency tests |
| backend-js/tests/admin-loading.test.js | Cookie-session request-generation test adaptation |
| backend-js/tests/admin-permissions.test.js | Existing P0-B matrix after identity resolution |
| backend-js/tests/audio-access.test.js | Existing P0-A stream matrix after identity resolution |
| INDIVIDUAL_ADMIN_ACCOUNTS_V1_REVIEW_2026-10-08.md | Review evidence, inventory and rollout plan |

All runtime/test/migration files match the reviewed paused implementation after
normalizing line endings. Only this document was updated during reconciliation.
The persistence file equals current master after removing its single new accessor.
Therefore the engagement mutation/count/commit/rollback sequence is preserved.
The P0-A audioAccess.js, P0-C scopedChanges.js, P0-B role arrays, publisher block,
public containment SQL, and Release Review browser retry correction are unchanged.
No listener/mobile, package, environment, native, schema-runner or old migration
changes. Migration 006 is not automatically applied by backend startup.

### Fresh Verification and Evidence Boundary

- Full Backend/Admin suite: 245 passed, 0 failed, 0 skipped, 0 cancelled.
  Includes all 41 Individual Admin tests (including parent groups), P0-A/B/C,
  Admin loading/permissions, Artist Applications, Release Review/private audio,
  public containment and all 13 engagement tests. Fresh run: 260.6 seconds.
- Listener/mobile plus authoritative engagement UI tests: 50 passed, 0 failed,
  0 skipped.
- Syntax: seven changed JavaScript files and the inline Admin script pass.
- git diff --check: pass. Secret-pattern scan: zero matches across the ten files;
  synthetic credentials in tests are not production credentials.
- Hardened 006 source is unchanged. It still revokes PUBLIC/anon/authenticated/
  service_role table and identity-sequence grants, enables restrictive RLS, keeps
  the trusted owner functional, and aborts atomically on unsafe final privileges.
- No production endpoint or database was contacted; no real credentials were used.
  Production containment and disabled publisher state are user-confirmed, not
  independently re-queried during this local-only preparation.

The operator explicitly authorized migration-dependent tests in disposable local
PostgreSQL databases only. Migration 006 is executed only by the automated fixture
on 127.0.0.1:55483, using unique throwaway databases and synthetic identities.
No production connection, schema application or credentials are involved. This
authorization does not permit production migration, commit, push or deployment.
No runtime, migration or test-source changes were needed for this final rerun.

Fresh final results:

| Gate | Result |
| --- | --- |
| 006 successful application, duplicate/partial failure rollback | PASS |
| Hostile global/schema defaults; PUBLIC/anon/authenticated/service_role denied | PASS |
| Restrictive RLS, identity-sequence ACLs, trusted non-superuser owner access | PASS |
| Inherited unsafe privileges and failed revocation abort atomically | PASS |
| Valid login; generic wrong/unknown/disabled denial; salted scrypt | PASS |
| Secure/HttpOnly/Strict, exact paths/lifetimes, HTTPS proxy and CSRF | PASS |
| Expiry/logout/revoke/change/reset/downgrade/disable invalidate access | PASS |
| Exact server-side role permissions; forged roles ignored | PASS |
| Recovery before migration/owner and after revoked sessions, distinct audits | PASS |
| Explicit-super recovery-only bootstrap, concurrent one-owner and rollback | PASS |
| Last active Super Admin protected across independent concurrent connections | PASS |
| Legitimate second-owner demotion/disable, single-connection pool safety | PASS |
| Super/Content private review preview; Support denial; preview revocation | PASS |
| Browser bootstrap, management, password change; 320/390/768/1440 layouts | PASS |
| P0-A/B/C, Artist Applications, Release Review and disabled publisher | PASS |
| Containment and authoritative follower/like counts | PASS |

Tests use local PostgreSQL 18.3, not the reported production PostgreSQL 17.6.
Cleanup verified zero remaining fixture databases and roles; the local test
PostgreSQL server was stopped after completion.
Live proxy, actual database-owner/grant drift, production migration and deployment
verification remain the controlled operator rollout checks below. Local success
does not assert that this undeployed implementation has passed production tests.

### Controlled Production Rollout (Prepared Only)

Every phase below requires separate production approval after the local gate.
Stop on failure; never repair authentication by weakening P0-A/B/C or containment.

**Phase A - Read-only prerequisites**

1. Fetch master, preserve all newer work, review the exact ten-file release and
   rerun the complete local suite with no failures/skips before a later commit.
2. Verify production /healthz is 200 with Supabase, and protected /admin-api/me
   succeeds through the existing environment bearer as explicit super_admin.
   Never print its value, headers or cookies.
3. Operator confirms SCHEDULED_PUBLISHER_ENABLED=false and no active automatic
   publication worker. Do not enable or change the flag.
4. Inspect target schema/global default ACLs, role memberships and the actual
   database owner used by the backend. Confirm all four 006 objects are absent.
   If any exist, STOP; do not drop, rerun blindly, or assume partial migration.
   Verify the manually applied public containment remains in place.

**Phase B - Approved database change**

1. Take a protected PostgreSQL backup/snapshot including schema, grants, policies
   and data. Record its recovery procedure securely, outside Git. Music JSON
   exports are not adequate backups of future Admin credentials/sessions.
2. Authorized operator applies ONLY the reviewed 006 in one connection using
   psql -X --set=ON_ERROR_STOP=1 --file=backend-js/migrations/006_individual_admin_accounts.sql.
   Supply connection authentication through the approved secure mechanism, not
   shell history, command-line URI, logs or chat. Do not run old migrations.
3. Verify exactly three Admin tables plus admin_accounts_id_seq, nine indexes,
   expected constraints/FK and three restrictive deny policies. Verify RLS is
   enabled and FORCE RLS is not enabled on the owner's tables.
4. Verify zero PUBLIC table/column/sequence ACL entries; check every effective
   table privilege (including TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) and sequence
   privilege for anon, authenticated and service_role. Inherited permissions
   count as permissions. Verify backend SQL owner access, not REST service_role.
5. If migration errors, ROLLBACK/disconnect and confirm no partial objects
   committed. Preserve existing music and containment. Do not use destructive
   cleanup or restore an old database over new production records.

**Phase C - Approved backend/Admin runtime**

1. Only after Phase B passes, deploy the reconciled backend/Admin revision.
   No listener OTA, PWA release, APK, catalog migration or publisher enablement.
2. Verify /healthz, Admin shell, protected recovery /me, read-only Applications
   and Release Review lists, guest public playback and Range/206.
3. Verify browser recovery login at /admin-api/break-glass-login over the actual
   HTTPS Render origin: 8-hour Secure/HttpOnly/SameSite=Strict cookie on /admin-api.
   Confirm X-Teso-Admin/same-origin protections and trusted forwarded-address
   handling. Keep logging redacted; never weaken cookie flags to pass a check.
4. Verify private preview uses a maximum 15-minute /api/ cookie and is unavailable
   after parent-session expiry/revocation. Use an approved synthetic private
   release fixture; never publish or mutate a real release for this check.

**Phase D - One intended owner**

1. Authenticate explicitly as break-glass Super Admin. Submit supplied owner
   display_name/login_identifier/password and explicit role super_admin to
   POST /admin-api/admin-accounts/bootstrap (or its Console form).
   No generated/default password; deliver it only through a secure operator path.
2. If response is lost, list accounts safely before retrying. Existing owner
   means bootstrap stays closed; use recovery reset/reactivation, not another
   bootstrap or deletion.
3. Log in individually. Verify /me identity/role and audit attribution, safe
   Super Admin reads, own password change, old-session rejection, fresh login
   and logout. No real content moderation is needed for verification.

**Phase E - Disposable lower-role Admin**

1. With explicit approval, create one identifiable test staff account with the
   intended lower role through individual Super Admin management.
2. Verify its exact P0-B permissions; deny staff management, infrastructure,
   sensitive exports and permanent deletion. Test only safe read/deny paths.
   Content Admin preview uses a synthetic approved test fixture; Support Admin
   preview must be denied. Do not modify real artist/listener records.
3. Disable the test account and revoke its sessions. Confirm copied API/preview
   sessions fail; preserve audit history. No Admin delete endpoint is introduced.

**Phase F - Normal operation and recovery**

Use individual identities daily. Retain environment break-glass only for recovery.
Do not remove/rotate its credentials during this rollout. Preserve new Admin
tables/audits and prefer narrow fix-forward on failure. Legacy bearer recovery and
its signed preview cannot be individually revoked by ordinary staff logout;
the legacy preview expires after 15 minutes, while the bearer needs separately
approved secret rotation. Browser recovery sessions are revocable.

### Current Decision

READY_FOR_INDIVIDUAL_ADMIN_ROLLOUT = YES for controlled rollout approval.
The complete local gate passed; the production phases above are not authorized
by local-test approval and have NOT been executed.
Production schema changed: NO. Production data changed: NO. Code committed: NO.
Code pushed: NO. Code deployed: NO. Production migration 006 executed: NO.
Migration 006 executed inside disposable local automated fixtures: YES.
Owner/staff created in production: NO. Environment changes: NO.
Scheduled publisher enabled: NO. OTA/PWA/APK published: NO.
