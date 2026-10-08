# Home & Discovery Release - 2026-10-06

Status: frontend released. Listener verification passed; remaining web-font and
Admin bootstrap issues are documented below. This is not an all-green Admin audit.

## Release identifiers

- Backend commit: `a41a53e` (bounded public discovery queries; deployed previously).
- Frontend commit: `167e1fb92bb6f97c93a34b8b01ee50e6d7ae3a1f`.
- Android OTA update: `01a110a2-e229-7c2b-8e1b-bbf6d08988ad`.
- OTA update group: `e2c7cec2-3d5b-45dd-84d4-00269702bb5c`.
- Channel and branch: `preview`; runtime and app version: `1.0.6`.
- Expo manifest request using Android/preview/1.0.6 returned the new update.
- PWA: https://tesohub-music-pwa.onrender.com
- Served web bundle: `AppEntry-1b5bed85e64bea49db6a2e2d3e6ca278.js`.
- Order: verified backend/listener authentication, published OTA, pushed frontend
  commit, observed Render's new PWA bundle, then ran post-deployment checks.

## Production checks

- Existing listener login, authenticated `/api/auth/me/`, and logout: HTTP 200.
  Wrong/absent credentials were rejected before the valid credentials were used.
- Final `/healthz`: HTTP 200, status ok, persistence_backend supabase.
- Catalog: 43 songs, 15 artists, 14 genres; bounded new/popular/featured/more and
  ID queries returned correct filtered/limited arrays. Unknown IDs returned [].
- Private music-audio range: HTTP 206, 1024 bytes, correct Content-Range.
- Real public Home at 320, 360, 390, 768 and 1280px: New releases, Popular songs,
  Featured artists, Genres, Featured songs and More to discover loaded. Empty
  Continue listening/followed sections were absent for a fresh guest.
- Real guest Home playback advanced the audio clock and created local Continue
  listening history. Play-count API writes were intercepted, not sent to production.
- A fresh shared-song route bypassed onboarding; actual private-storage-backed
  public audio played, paused, and resumed without registration.
- Existing-account Home, followed artists, Profile, Library and Help & Support
  loaded. Account likes/follows matched before and after. Playlists, own support
  requests and artist-application reads returned 200.
- SPA document routes /, /search, /library, /artist/14, /song/37, /release/1,
  /playlist/1, /artist-studio, /profile and /support served the new application.
  The release/playlist route checks validate SPA fallback, not nonexistent records.
- PWA manifest and service-worker script returned 200. The deployed bundle uses
  the Render API URL and contains no database URL, Supabase-secret or test-credential
  variable markers.

## Isolated regression checks

27 unit tests passed, and Android/web production exports passed. The exported
Android bundle was the one published, without another APK/native build.

The deployed PWA also passed browser suites with isolated API fixtures for:

- Discovery at all five widths, new and returning accounts, history reconciliation,
  follows/likes, genre navigation/refresh, bounded requests and no duplicate fetches.
- Empty catalog, slow sections, 12-second request timeout, targeted Retry, partial
  failures and branded artwork fallback.
- Onboarding at 320/390/tablet/desktop: Skip, Start Listening, remembered completion,
  warm/fresh shared links, guest account prompts, Keep listening, Support, prior
  listening history and preference-storage failure.
- Profile/Library at 320/360/desktop: profile edit/support/artist access/logout,
  stale-account reconciliation, like/unlike rollback, follow/unfollow/Undo/counts,
  playlist creation/reload and removed engagement remaining removed after reload.
- Sharing at 320/390/desktop: exact route/refresh, copy, Web Share, duplicate guard,
  playback handoff, artist menu, private/missing songs and Artist Studio visibility.

These isolated write scenarios did not modify production accounts or catalog data.
After font-loading failures, the repeatable isolated suites used font bytes fetched
from the deployed PWA. Later Library/sharing suites also reused deployed JS/logo
bytes between pages. API fixtures were explicitly isolated; the separate real
catalog/audio checks did not substitute fixture responses for production reads.

## Remaining issues and limits

1. Uncached isolated browser runs intermittently reported Expo's `12000ms timeout
   exceeded` while loading its icon font. One screenshot also timed out waiting for
   fonts. Real-catalog tests at all five widths passed without font prefetching, but
   the intermittent cold-asset problem is not fixed by this release.
2. Admin login and individual songs/artists/genres/support/settings/discovery reads
   passed. Opening the actual Admin Console triggered HTTP 500s on several requests
   in its initial parallel load, leaving incomplete featured lists during tests.
   Full Admin Home & Discovery UI verification therefore remains incomplete. No
   editorial selections were toggled. Source inspection shows a burst of many full
   persistence snapshots and a small default pool; queue contention is a plausible
   cause, not a production-log-confirmed diagnosis. No backend fix/config change was
   made as part of this frontend release.
3. Some catalog artwork is externally hosted and slow/unreliable; the branded
   placeholder was visible. Existing artwork records were not replaced.
4. No physical Android device was connected. Export and OTA delivery were verified,
   but on-device installation/rendering still needs a phone check.
5. Production registration, artist uploads and engagement writes were not exercised
   against real user data. Relevant UI/engagement behavior was checked with fixtures.

## Preservation and cleanup

No new APK, native configuration, SDK, dependencies, runtime, permissions, Supabase
schema, migrations or production catalog changes. Authentication tests created and
logged out only their test sessions. The supplied account's collections were left
unchanged. Saved Windows User test-email/password variables were removed afterward.

Unrelated local migration/script changes and export directories were left untouched
and excluded from the frontend commit. No backend secrets were included in the app.
