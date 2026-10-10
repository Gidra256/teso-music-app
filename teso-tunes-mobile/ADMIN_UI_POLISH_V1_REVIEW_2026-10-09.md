# Admin UI Polish V1 - Local Review

Status: release preparation in progress. Scalability extension must pass the final gate before committing. No deployment authorized.

Branch: `codex/admin-ui-polish-v1`.
Base: `9b968d4a2a7fa69006c4259618e9e815604c18d7`.
Prepared for one focused local commit after the final gate. No push, deployment, production API call, or production mutation performed.

## Problems addressed

- Mobile navigation expanded into a long grid on most sections; compact navigation was limited to Applications and Releases.
- Nested framed panels, heavy typography, viewport-scaled headings and tightly packed actions obscured hierarchy.
- Admin identity and role were combined into a small single line.
- Catalog, Users and Support search rerendered their input and lost keyboard focus/caret.
- Navigation rerenders could lose scroll position and hide the selected section.
- Review identity, metadata, history and decisions lacked clear visual separation.
- Admin access updates, password reset and session revocation were visually crowded; save versus revoke behavior was unclear.
- Several filters had no accessible label; keyboard focus and disabled states needed improvement.

## Changes

- Full-height desktop sidebar, clearly selected navigation, separate signed-in identity and readable role; horizontal scrolling navigation on mobile/tablet, with Logout and Refresh available across sections.
- Restrained dark neutral surfaces, retained cyan/magenta brand accents and existing logo, fixed-size headings, consistent spacing and 44px command targets.
- Existing real dashboard metrics only, compact permission-filtered quick actions; no new metrics or production sample data.
- Flat content sections and divided rows, responsive forms, retained bounded desktop list/form scrolling and normal document scrolling on smaller screens.
- Application/release identity blocks, compact artwork, readable metadata rows, separated review history and decisions. Native audio controls and existing retry/confirmation behavior retained.
- Admin account cards show display name, login, explicit role, Active/Disabled, created/last-login dates, optional permissions detail, access settings, and a distinct session/password section.
- Explicit copy explains Update access applies role/status changes and revokes sessions; Revoke all sessions does not save draft role/status changes.
- Public support replies and internal notes are visually distinct. No changes to their visibility rules or backend authorization.
- Live status announcements, visible keyboard focus, named filters, search focus/caret restoration and retained active-navigation position.

## Exact changed-file inventory

1. `backend-js/public/index.html` - Admin presentation and search/navigation focus behavior only.
2. `backend-js/tests/admin-ui-browser.test.js` - role-aware responsive browser regression coverage.
3. `backend-js/tests/fixtures/admin-ui-preview.js` - loopback-only synthetic read-only fixture server; not served by the production application.
4. `ADMIN_UI_POLISH_V1_REVIEW_2026-10-09.md` - this report.

## Verification

- Backend/Admin: **252 passed / 0 failed / 0 skipped**. Complete `node --test --test-concurrency=1 tests/*.test.js` suite, including new browser coverage.
- Listener/mobile: **50 passed / 0 failed / 0 skipped**, including engagement UI regression.
- P0-A/private audio and Range/seek/retry, P0-B role enforcement, P0-C scoped writes, Individual Admin sessions/ACLs, Artist Applications, Release Review, containment, and authoritative engagement regressions passed.
- Database-backed tests used disposable local PostgreSQL on loopback port 55483, with UTC. No production migration was run.
- Chrome browser checks passed at **320, 360, 390, 430, 768, 1024, 1280 and 1440px** for every available section of each of the four roles. No horizontal page overflow or clipped form/action/audio controls.
- Expanded reset-password form also checked at 320x480; its input and submission action remain reachable by scrolling.
- Super Admin: all existing sections, including Management and Account Security, accessible.
- Content Admin: applications, releases, catalog, artists, discovery, genres and own security; no privileged management/infrastructure sections.
- Moderator: catalog, artists, users, reports and own security; no applications/releases/management/infrastructure sections.
- Support Admin: Support and own Account Security only; public-reply and internal-note areas fit.
- Artist Applications: All/Pending/search/clear/refresh/loading/empty/error/403/retry, decisions and duplicate guard passed in existing browser tests.
- Release Review: filters/read-only publication inspection, artwork/audio, Range seek, buffering/error/retry, decisions and duplicate guard passed.
- Admin Management: local real-database account/session workflows passed; new browser checks cover layout, labels, disabled badge, expanded reset and save/revoke distinction.
- Syntax checks, `git diff --check`, and secret-pattern scan passed.
- AST/source comparison against the base confirmed non-presentation JavaScript units unchanged, including auth, permissions, data sources, HTTP calls, mutation handlers, session renewal, and login/logout listeners.

## Local preview and evidence

Run from `backend-js`: `node tests/fixtures/admin-ui-preview.js 55179`.

- Super Admin: `http://127.0.0.1:55179/?role=super_admin`
- Content Admin: `http://127.0.0.1:55179/?role=content_admin`
- Moderator: `http://127.0.0.1:55179/?role=moderator`
- Support Admin: `http://127.0.0.1:55179/?role=support_admin`

The preview is marked LOCAL PREVIEW, uses only synthetic records and silent test audio, binds exclusively to loopback, rejects mutation requests, and does not connect to production. It is not a replacement production login.

Screenshots: `%TEMP%/tesohub-admin-ui-polish-screenshots/` (dashboard, review detail, Admin Management, Support, and role-specific Account Security; includes phone viewport captures).

Test dependencies are supplied through existing `TESO_PLAYWRIGHT_MODULE`, `TESO_AUDIO_PGLITE_MODULE` and `TESO_P0C_POSTGRES_PORT` test configuration. No runtime dependency was added.

## Boundaries and limitations

- Production schema/data: unchanged. Migration 006 and public-schema containment: untouched.
- Authentication, permissions, break-glass, sessions, private-audio authorization, review business rules and engagement persistence: unchanged.
- Scheduled publisher configuration/behavior: unchanged; not enabled.
- Listener mobile/PWA runtime and native/APK configuration: unchanged.
- Existing destructive confirmations retained; no new confirmation workflow or backend permission boundary introduced.
- No server pagination or new analytics endpoints added. Client rendering is now paged as described below.
- Browser verification used desktop Chrome at responsive widths, not a physical Android/iOS keyboard or Safari. Production verification is intentionally deferred until a separately approved release.
- No push, deploy, OTA, PWA publication or APK build occurred. The local preview remains running for review; disposable PostgreSQL test server is stopped after test cleanup.

## Scalability extension

- All record collections render at most 25 entries per list page: artists, songs, applications, releases, users, tickets, reports, discovery lists, genres, Admin accounts, and audit logs.
- Review histories, support messages and internal notes also page in groups of 25. Paging replaces only its own region and preserves unsaved form/review text.
- Artist rows use 40px thumbnails, concise identity/status/engagement metadata and expandable contextual actions. No profile-sized artist cards.
- Catalog rows use small artwork, title/artist/genre, status, counts and release date when available. Actions/audio preview expand on demand; list audio uses preload=none.
- Application queues omit long biographies/contact detail until the dedicated review is opened. Release list/detail separation and existing status/date ordering remain intact.
- Artist search/status filtering added locally; existing song/application/release filters retained. Catalog and artist filtering update the list only, preserving adjacent form drafts.
- Catalog artist choices are bounded to 25 name matches plus the selected artist. Searching finds artists outside the initial subset; editing retains an artist outside that subset.
- Dashboard remains existing summary metrics and a small permission-filtered shortcut set, never a catalog grid.
- Large synthetic fixtures: 500 artists, 2,000 songs, 250 releases AND 250 applications; additionally 500 tickets, 100 audit entries and 250-entry review histories.
- Tests assert 25 rendered records per collection, fewer than 2,500 view DOM nodes, usable next/previous pages, search across all loaded records, retained drafts/selection, no horizontal overflow, and compact rows at all eight widths.
- Large preview: http://127.0.0.1:55179/?role=super_admin&large=1.
- Existing production startup remains `node server.js`; only `backend-js/public` is mounted at `/admin`. The fixture is outside that directory, is not imported by production, and can only start explicitly on loopback.

### Backend limitations and later work

This release bounds DOM/rendering, NOT network payloads or backend/database work.
Artists and songs currently return whole collections; Applications and Releases do not offer page/cursor parameters. Search/filter/sort operate over loaded arrays.
Support's existing query returns at most 250 tickets; audit defaults to the latest 100 (existing supported limit is capped at 200). This UI does not invent an offset/cursor or imply older records are available.
Future backend work should add authorized cursor pagination with deterministic ordering and server-side search/status/sort, totals or has_more, and lean list payloads. Support/audit need a cursor for older records; histories/conversations and artist choice lookup should also gain bounded query APIs.
No such API, schema, permission or persistence changes are part of this release.
