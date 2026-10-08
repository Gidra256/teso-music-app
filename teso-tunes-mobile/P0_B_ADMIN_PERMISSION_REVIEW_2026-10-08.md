# P0-B Admin permission hardening

Status: LOCAL ONLY. No commit, push, deployment, production API call or migration.
Date: 8 October 2026 (Africa/Kampala).
Baseline: deployed P0-A v2 `010d42a20935a7dfcbdb226efde1d944dc25573d`.
Branch: `codex/p0-b-admin-permissions`, isolated worktree. Existing working checkout and both P0-A release worktrees preserved.

P0-A status supplied by owner: DEPLOYED, core protection active; public playback, Range/206, Admin authentication and secure preview-cookie behavior verified. Remaining multi-identity/private/scheduled fixture cases belong in staging. P0-B neither reopens those checks nor changes the audio implementation.

## 1. Existing authentication and role model

There is one environment-configured Admin identity per backend process, not a database of individual Admin accounts. `/admin-api/login` compares the configured username/password and returns the process's Admin token and configured role. `/admin-api/me` uses the bearer token. `requireAdminPermission` strips the Bearer prefix, trims whitespace and compares with the process token; mismatch returns generic 403. It then looks up server-side role permissions. Multiple permission arguments mean OR. `*` satisfies all permissions. Request-body roles, custom role headers, listener tokens and preview cookies do not grant Admin access.

The existing `ADMIN_ROLE` configuration selects one of these roles:

| Role | Deployed permission mapping | Local P0-B mapping |
|---|---|---|
| super_admin | `*` | unchanged |
| content_admin | applications, artists, catalog, discovery, genres, releases | unchanged |
| moderator | reports, users, artists, catalog | unchanged |
| support_admin | users, support:view, support:reply, support:note, support:update | removes users; retains all four Support permissions |

Existing named permission vocabulary: `applications`, `artists`, `catalog`, `discovery`, `genres`, `releases`, `reports`, `users`, `settings`, `support:view`, `support:reply`, `support:note`, `support:update`, plus wildcard `*`. Only Super Admin can currently satisfy `settings` or `*`.

No new role or permission name was introduced. `requireSuperAdmin` is an alias for the existing `requireAdminPermission("*")` mechanism. There is no Admin-role-edit, Admin-account-create, credentials-edit or generic listener-role-edit API in this route inventory. Artist-application approval assigns the existing listener/artist relationship as part of the intended content workflow, not an Admin privilege.

Final blocker fix: `ADMIN_ROLE` now requires an exact, case-sensitive string matching an own entry in the existing role map. Missing, empty, whitespace-only, padded, malformed, unsupported and unknown values resolve to null with zero permissions. Prototype-property names cannot qualify as roles. Login and every protected Admin API return generic HTTP 403 for invalid configuration, even with correct credentials. No token or preview cookie is issued. Valid explicitly configured roles retain their existing permissions. The shared permission helper also rejects invalid identity roles without throwing.

Previously, `cleanText(process.env.ADMIN_ROLE || ADMIN_ROLES.SUPER_ADMIN)` defaulted missing/empty configuration to Super Admin, then an unrecognized trimmed role fell back to Super Admin again. The old inherited-property lookup could also accept prototype names and cause errors. Both configuration privilege fallbacks and that inherited-property lookup have been removed.

Architecture limits:
- Anyone sharing the same deployment Admin token shares its configured role. The test matrix represents four isolated backend role configurations, not four independently provisioned production Admin users.
- Before deployment, explicitly configure and validate `ADMIN_ROLE`. Invalid configuration intentionally locks out Admin login/API access instead of granting a fallback role. No production environment value was inspected or changed. This is a shared resolver fix, not a credential/session redesign.
- Existing fallback Admin credentials and process-generated token behavior remain an operational security concern; no credentials were read, rotated, logged or changed for P0-B.

## 2. Frontend findings

Before P0-B, the frontend received role/permission data but used it only for the identity display. Every navigation item, dashboard shortcut and content action was rendered. Backend guards still existed on many domain routes, but ordinary action-level 403 responses discarded the Admin token. Resource reads had better permission/error separation already.

Local changes use the returned permissions to hide inaccessible navigation/shortcuts and cross-domain controls. Support starts on Support and does not request dashboard, health or global users. Content/Moderators no longer request platform-health as a dashboard dependency. Super Admin keeps every existing view. Forbidden actions show a permission message without logging out; identity 401/403 still requires sign-in, and server/network errors remain separate. Backend checks remain authoritative even with forged frontend state.

## 3. Full Admin route inventory

All 60 explicit `/admin-api` registrations were inspected. Express also serves HEAD through GET handlers; those inherit and are tested against the same guards. No additional Admin router or alias was found.

Abbreviations: `Auth` = any valid configured Admin token, no operation permission; `SA` = wildcard/Super Admin; `SUP` = Support; `SEC` = account/security; `INFRA` = infrastructure/high risk; `CONTENT` = content management; `LOW` = operational read. In the Policy column, "same" preserves the preceding requirement. The final column assesses the old guard and describes the abuse risk.

Every path below is prefixed with `/admin-api`.

| Method | Path | Class | Previous guard -> local policy | Old guard appropriate? / risk |
|---|---|---|---|---|
| POST | /login | SEC | configured username/password -> same | Yes for login; shared identity limitations above |
| GET | /me | LOW | Auth -> same | Yes; identity and eligible audio cookie only |
| DELETE | /audio-preview-session | SEC | Auth -> same | Yes; clears caller's preview cookie; P0-A untouched |
| GET | /dashboard | LOW | Auth -> artists OR catalog OR releases OR reports | Too broad for Support; aggregate operational visibility; old read also auto-published due releases |
| GET | /support/tickets | SUP | support:view -> same | Yes; ticket/account context required by Support |
| GET | /support/tickets/:id | SUP | support:view -> same | Yes; includes staff notes within authorized Support |
| POST | /support/tickets/:id/replies | SUP | support:reply -> same | Yes; public reply impersonation risk is permission-gated |
| POST | /support/tickets/:id/notes | SUP | support:note -> same | Yes; staff-only note write |
| PATCH | /support/tickets/:id | SUP | support:update -> same | Yes; status, priority and assignment |
| GET | /support/tickets/:id/attachments/:kind/:attachmentId | SUP | support:view -> same | Yes; authorized private Support attachment retrieval |
| GET | /users | SEC | users (Moderator + Support + SA) -> users (Moderator + SA) | Too broad for Support; global account/session metadata enumeration |
| POST | /users/:id/suspend | SEC | users -> users without Support | Too broad for Support; denial of account access; retained for moderation |
| POST | /users/:id/restore | SEC | users -> users without Support | Too broad for Support; reversal of account moderation |
| POST | /users/:id/revoke-sessions | SEC | users -> SA | No; lower roles could invalidate all user sessions |
| GET | /genres | CONTENT | genres -> genres OR catalog; restricted projection for catalog-only | Too restrictive as Catalog dependency; management metadata not needed by Moderator |
| POST | /genres | CONTENT | genres -> same | Yes; genre creation |
| PUT | /genres/:id | CONTENT | genres -> same | Yes; genre renaming/order |
| POST | /genres/:id/activate | CONTENT | genres -> same | Yes; genre availability |
| POST | /genres/:id/deactivate | CONTENT | genres -> same | Yes; genre availability |
| GET | /platform-settings | INFRA | settings -> same (SA only) | Yes; operational configuration visibility |
| PUT | /platform-settings | INFRA | settings -> same (SA only) | Yes; registration, uploads, maintenance and policy switches |
| GET | /feature-flags | INFRA | settings -> same (SA only) | Yes; Admin feature configuration visibility |
| PUT | /feature-flags | INFRA | settings -> same (SA only) | Yes; platform behavior switches |
| GET | /reports | CONTENT | reports -> same | Yes; moderation queue and reporter context |
| POST | /reports/:id/status | CONTENT | reports -> same | Yes; report status/notes |
| GET | /discovery | CONTENT | discovery -> same | Yes; curation visibility; existing due-publication behavior retained |
| GET | /platform-health | INFRA | Auth -> SA | Too broad; internal persistence/storage diagnostics and global counts |
| GET | /audit-log | SEC | Auth -> SA | No; cross-domain account/action details and potentially sensitive log metadata |
| GET | /persistence-export | INFRA | Auth -> SA | No; entire persistence export, including optional password/session hashes |
| GET | /supabase-migration/jobs | INFRA | Auth -> SA | No; migration operational details/log output |
| GET | /supabase-migration/jobs/:id | INFRA | Auth -> SA | No; same for an individual job |
| POST | /supabase-migration/schema | INFRA | Auth + confirmation -> SA + same confirmation | No; schema migration execution |
| POST | /supabase-migration/migrate | INFRA | Auth + confirmation -> SA + same confirmation | No; database/media migration and overwrites |
| POST | /supabase-migration/validate | INFRA | Auth + confirmation -> SA + same confirmation | No; privileged validation process and storage/database access |
| GET | /artist-applications | CONTENT | applications -> same | Yes; applicant personal data needed for review |
| POST | /artist-applications/:id/approve | CONTENT | applications -> same | Yes; intended artist onboarding, not Admin role assignment |
| POST | /artist-applications/:id/reject | CONTENT | applications -> same | Yes; application review and listener/artist workflow |
| POST | /artist-applications/:id/request-changes | CONTENT | applications -> same | Yes; application review |
| GET | /releases | CONTENT | releases -> same | Yes; private review metadata; P0-A guards audio independently |
| GET | /releases/:id | CONTENT | releases -> same | Yes; individual release review metadata |
| POST | /releases/:id/approve | CONTENT | releases -> same | Yes; intended approve/schedule/publish workflow |
| POST | /releases/:id/reject | CONTENT | releases -> same | Yes; rejects submitted/scheduled releases |
| POST | /releases/:id/request-changes | CONTENT | releases -> same | Yes; returns submitted/scheduled releases for changes |
| GET | /artists | CONTENT | artists -> same | Yes; artist management metadata |
| POST | /artists | CONTENT | artists -> artists; Featured changes additionally require discovery | Incomplete; Moderator could bypass Discovery using is_featured |
| PUT | /artists/:id | CONTENT | artists -> artists; Featured changes additionally require discovery | Incomplete; same bypass; omitted Featured now preserved for non-curators |
| DELETE | /artists/:id | CONTENT / INFRA | artists -> artists; DELETE FOREVER additionally requires SA | Incomplete; permanent artist/song/follow destruction allowed to lower content roles |
| POST | /artists/:id/suspend | CONTENT | artists -> same | Yes; intended artist moderation |
| POST | /artists/:id/restore | CONTENT | artists -> same | Yes; intended artist moderation |
| POST | /artists/:id/feature | CONTENT | discovery -> same | Yes; curation |
| POST | /artists/:id/unfeature | CONTENT | discovery -> same | Yes; curation |
| GET | /songs | CONTENT | catalog -> same | Yes; catalog management metadata; P0-A guards audio |
| POST | /songs | CONTENT | catalog -> catalog; Featured changes additionally require discovery | Incomplete; Moderator could bypass Discovery using is_featured |
| PUT | /songs/:id | CONTENT | catalog -> catalog; Featured changes additionally require discovery | Incomplete; same bypass; omitted Featured now preserved for non-curators |
| DELETE | /songs/:id | CONTENT / INFRA | catalog -> catalog; DELETE FOREVER additionally requires SA | Incomplete; permanent song/like destruction allowed to lower content roles |
| POST | /songs/:id/hide | CONTENT | catalog -> same | Yes; ordinary content moderation |
| POST | /songs/:id/restore | CONTENT | catalog -> same | Yes; ordinary content moderation; P0-A publication rules still apply |
| POST | /songs/:id/remove | CONTENT | catalog -> same | Yes; reasoned soft removal, not hard deletion |
| POST | /songs/:id/feature | CONTENT | discovery -> same | Yes; curation |
| POST | /songs/:id/unfeature | CONTENT | discovery -> same | Yes; curation |

## 4. Confirmed vulnerabilities and least privilege

- All lower Admin roles could invoke all three migration operations with the publicly knowable confirmation string. Confirmation is an accidental-action guard, not authorization.
- All lower roles could read migration-job lists/details and the full persistence export. The explicit include_sensitive/confirm query could reveal password/session hashes; even redacted exports include personal data and private media references. Both export modes now require SA.
- All lower roles could inspect cross-domain audit logs and internal health data. These now require SA.
- Support inherited user suspension/restore/session revocation and global account enumeration. Support now gets safe name/contact/role/status/artist context only through its existing ticket responses. Those responses do not expose password/token hashes. No new global user-read permission was granted.
- Moderator retains intended user suspension/restoration and artist/catalog moderation. Session revocation is now SA-only.
- Content and Moderator hard-delete paths now require SA, while ordinary soft removal keeps its domain permission. The extra guard runs before database load or mutation.
- Moderator cannot alter discovery curation via ordinary artist/song create/edit. Unchanged explicit values and omitted values on edits do not erase existing curation; authorized curators retain the prior form behavior.
- Existing settings and feature-flag permissions were already SA-only through `settings`, and remain so.
- No backup/restore, arbitrary environment update, Admin-role management or separate destructive maintenance endpoint was found beyond the listed migration/export/hard-delete paths.

## 5. Moderator dependency fix

Original view dependencies were Artists -> artists + genres and Catalog -> songs + artists + genres. The Moderator has artists/catalog but not genres, so the entire page could enter a dependency error despite valid domain access. Artist forms do not use genres at all.

Local solution:
1. Remove the unnecessary Artists -> genres request for every role.
2. Permit catalog readers on GET /admin-api/genres only, returning active `{id, name, active: true}` choices. Managers keep the existing full genre response, including inactive entries and metadata.
3. POST/PUT/activate/deactivate remain `genres`-only. Moderator's permission list is unchanged and it receives no genre-management or discovery permission.
4. Hide Featured controls for non-curators and Revoke sessions for non-SA. Inaccessible navigation and shortcuts are also hidden; manually constructed API requests are still denied by the server.

## 6. Tests and isolation

Final backend suite after the fail-closed blocker fix: **83 passed, 0 failed, 0 skipped**, including all 46 previous tests, the initial 16 P0-B tests and 21 role-configuration regressions. The PGlite dependency is in a temporary tools directory outside the repository; no package manifest/lockfile changed.

| Coverage | Result |
|---|---|
| Independent expected policy covering every one of 60 Admin registrations for each of four roles | PASS |
| All four valid configured roles retain login, identity and exact permission mapping | PASS |
| Seventeen invalid/missing configuration cases deny login and every Admin route, including GET/HEAD, sensitive export and permanent-delete variants | PASS |
| Invalid configuration grants no private reviewer access through bearer or an existing valid preview cookie; public audio remains public | PASS |
| GET and inherited HEAD checks; all registered mutation methods | PASS |
| Missing/invalid token and forged role/cookie headers on every protected route | PASS |
| Lower roles denied before DB/upload/migration/audit work on high-risk routes | PASS |
| Both redacted and sensitive export modes denied to all lower roles | PASS |
| SA migration confirmations, export modes, settings, flags, revoke-sessions and hard deletes | PASS using isolated stubs |
| Support ticket context/read/reply/note/status/attachment workflows; account controls denied | PASS |
| Moderator active genre projection and genre-write denials; catalog/user moderation works | PASS |
| Moderator curation field bypass denied; ordinary edits preserve Featured; default creates work | PASS |
| Content release approve/schedule/reject/request-changes and catalog/discovery/genre actions | PASS |
| Dashboard no longer calls the publishing catalog reader | PASS |
| Support startup/dependencies, role-aware navigation, Moderator form dependencies/controls | PASS |
| Action 403 retains session and displays permission message; identity failures require sign-in | PASS |
| Existing P0-A public/private authorization, cookies, Range/206/416, SQL publication/ownership | PASS |
| Existing playlist, sharing, discovery, snapshot-loading and Admin-loading regressions | PASS |

The matrix registers the actual source middleware with terminal allow handlers, and fails if any Admin route is missing from its independent policy table. Additional HTTP tests execute actual route callbacks with synthetic in-memory persistence and migration/storage stubs, verifying permitted workflows and absence of side effects on denial. No production tokens, databases, recordings or migration processes are used. This is not a claimed live Supabase end-to-end test for P0-B.

Headless Edge checks: all four role configurations passed with actual Admin HTML, fixture-only HTTP responses and zero page errors. Verified startup/navigation, Artists/Catalog access, genre choices and Featured-control visibility. No production URLs were contacted.

Syntax check, git diff --check and secret-pattern scan passed. The audio authorization routes/helpers and public-song serializer region match the deployed baseline; audioAccess.js, supabasePersistence.js and both P0-A test files are unchanged. The listener/Artist Studio/playlist route region is byte-identical to baseline. Existing shared role mappings affecting audio (catalog/releases) are unchanged for every role.

## 7. Files changed

- `backend-js/server.js`: Support least privilege, SA high-risk guards, read-only dashboard, minimal genre lookup, permanent-delete gate, curation-field guard and fail-closed role resolution/login/API authorization.
- `backend-js/public/index.html`: permission-aware visibility/dependencies and error handling only; no layout/branding redesign. P0-A preview renewal/logout behavior retained.
- `backend-js/tests/admin-permissions.test.js` (new): independent all-route/four-role HTTP matrix, synthetic workflow tests and valid/invalid role-configuration regressions.
- `backend-js/tests/admin-loading.test.js`: four additional role-aware frontend regressions.
- `P0_B_ADMIN_PERMISSION_REVIEW_2026-10-08.md` (this report).

No migration, schema, persistence architecture, listener/mobile/PWA source, package manifest, lockfile, native/APK configuration or production data changed. No P0-C snapshot-write work included.

## 8. Deployment risk and rollback / fix-forward

Risk: medium, security-sensitive. Expected behavior changes are lower-role 403s, restricted genre projection, Support landing in Support, and hidden unauthorized controls. Missing/invalid role configuration now intentionally causes Admin lockout; verify `ADMIN_ROLE` before deployment. External Admin scripts relying on broad lower-role privileges will need an authorized role, not a bypass. The single-identity/global-role limitation must not be mistaken for per-user RBAC.

Before any separately approved deployment: confirm the intended explicit ADMIN_ROLE, rerun all tests, review the exact backend/Admin diff together, and reload existing Admin tabs so the new permission-aware UI is used. Staging should cover actual separate role configurations and disposable data. No production session or credential changes are part of this proposal.

Prefer fix-forward for any permission or UI regression. Preserve the new server-side high-risk guards even if a UI change must be reverted. Do not broadly grant Moderator genres/discovery or restore Support users to work around a dependency error. A full P0-B rollback to the P0-A baseline would reopen these known Admin authorization gaps; use fail-closed route blocking if emergency rollback is unavoidable. Never revert P0-A private-audio protection. There are no schema/data changes to undo.

**NOTHING WAS DEPLOYED. Stop for review and approval.**
