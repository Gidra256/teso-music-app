# Home and Discovery: Local Implementation Report

Status: implemented locally, not committed/pushed/published. No OTA, PWA deployment,
APK build, migration, or deliberate production write was performed.

## 1. Files changed

- `mobile/src/screens/HomeScreen.js`: independent discovery sections, loading,
  retry, compact history, followed artists and genre navigation.
- `mobile/src/screens/SearchScreen.js`: exact genre filter, clear action and
  query-string refresh support using the existing Search route.
- `mobile/src/components/ArtistCard.js`: correct compact flex sizing, square
  artwork, readable metadata, 44dp Follow target and existing branded image placeholder.
- `mobile/src/components/SongCard.js`: optional Continue Listening action,
  readable compact metadata, 44dp compact Like target and existing branded image placeholder.
- `mobile/src/api/musicApi.js`: bounded Home reads, in-flight request coalescing
  and a 12-second abort timeout. No stale disk-cache fallback for discovery.
- `mobile/src/utils/discovery.js`: deterministic, truthful section selection.
- `backend-js/discovery.js`: validated, bounded query options and parameterized
  SQL projection helpers; corresponding selection for the existing legacy mode.
- `backend-js/server.js`: optional parameters on existing songs/artists routes;
  direct Supabase genre read. Existing unfiltered API contracts are unchanged.
- `backend-js/supabasePersistence.js`: bounded catalog SQL and active-genre query.
- `backend-js/tests/discovery.test.js`: query, route and compatibility coverage.
- `mobile/scripts/test-discovery.cjs`: selection, deduplication and timeout tests.
- `mobile/scripts/verify-discovery.cjs`: production-export browser acceptance.
- `mobile/scripts/verify-onboarding.cjs`: explicit featured flags in isolated test
  fixtures to match the real Admin-controlled semantics.
- This report. Generated exports are in `mobile/dist-discovery-review/`.

Pre-existing migration files and changes to `apply-supabase-schema.js` were left
alone. No schema, native configuration, dependency, playback-engine, permissions,
Support API or sharing route changes.

## 2. Old Home

Featured songs, Featured artists, Most liked songs, Most followed artists, and
Trending now. Trending now was simply the first ten catalog songs, not a measured
trend. Zero-engagement items could appear in ranked rows. Two full catalog reads
plus two featured reads were awaited together: any rejected request blocked Home.
No Home history, new-release section or genre entry points. Compact artist flex
sizing could collapse the artist name on web.

## 3. New Home order

1. Continue listening, only when public listening-history entries exist.
2. New releases, only when eligible dated songs exist.
3. Popular songs, only when positive recorded play counts exist.
4. Featured artists, selected by Admin.
5. Genres, from the active public genre catalog in Admin order.
6. Artists you follow, only for authenticated listeners with matching follows.
7. Featured songs, preserving Admin's curated song selection.
8. More to discover, excluding songs already represented in other rows where possible.

Personal sections are absent for new/empty-history listeners. No invented
personalization, counts, songs, artists or genre names. Large saved collections
remain in Your Library. More to discover links to the existing full Songs screen;
other headings have no misleading See All link. Horizontal rows retain the
existing dark/cyan/magenta identity, typography, logo and navigation.

## 4. Real data sources

Read-only production audit on 2026-10-03 found 43 public songs, 15 artists and 14
active genre names. All 43 songs had release dates and positive stored play counts;
8 songs and 7 artists had featured flags. These are existing records, not data
created by this task. Artwork URLs and all engagement values remain backend-sourced.

Home uses existing `/api/songs/`, `/api/artists/`, and `/api/genres/` routes. Optional
`discovery`, `limit` and `ids` query parameters do not change their array response
shapes. Account follow IDs come from the existing reconciled engagement context.

## 5. New Releases

Only published songs with real, non-future `release_date` values, newest date first,
then ID for stable ties. Missing dates are not replaced with upload/creation dates.
Undated songs can still appear in other appropriate sections.

Artist Studio/Admin release records have release type, release date, published
timestamp and a public-song reference, but there is no safe public album/release
listing API. Existing `/release/:id` navigation is a legacy player redirect, not
an album detail API. This implementation therefore uses published songs, not private
Studio records or invented album cards/types. Existing release navigation is untouched.

## 6. Popular versus Trending

Positive cumulative `play_count` exists and is incremented by the existing play API.
Popular songs sorts by that count. This is not a weekly chart, unique-listener count
or fraud-resistant trend: Admin can edit these counts and no public time-windowed
trend metric exists. The misleading Trending label was removed.

Popular prefers alternative songs when New Releases already contains the leaders.
A very small catalog may retain up to three genuine overlaps rather than falsely
implying no popularity. Featured songs deliberately preserve editorial relevance.
More to discover never fills a row with duplicates just to make it look busy.

## 7. Featured Artists

Uses the existing `is_featured` flag and public artist visibility rules. No automatic
or fabricated featured designation. An empty curated selection hides the row.
Compact artist cards now preserve their actual width as well as square artwork,
so names, follower counts and Follow controls remain visible.

## 8. Continue Listening

Uses the existing device-local Recently Played order (up to six IDs requested,
three compact entries shown). One bounded public catalog query reconciles these
IDs; hidden/removed/unpublished or missing songs are not revived from old snapshots.
Tapping an active song opens the existing player without restarting it; another
song starts through the normal player and opens it. No new persisted playback offset:
after a full app restart, a previously played song starts normally rather than
pretending to resume a saved timestamp. Full history remains in Your Library.

## 9. Admin controls found

- Home & Discovery lists featured songs and featured artists.
- Existing feature/unfeature actions set their `is_featured` flags.
- Catalog management supplies release dates, genre, artwork, play count and visibility.
- Genres can be added, renamed, activated/deactivated and ordered by position.
- Release moderation already publishes/schedules approved music into public songs.

Home now honors active genre order and curated flags. No Admin design, permission,
database or control changes were needed. No existing Home section-order CMS exists.

## 10. Performance and resilience

Initial Home makes six independent requests instead of four all-or-nothing requests.
This is a payload/latency-isolation improvement, not a claim of fewer HTTP requests.
The new server queries cap the response at 60 song records across four candidate
lists, eight featured artists and the active genre names. Optional continuity adds
one request for six history songs and one for eight followed artists, never N+1.
Displayed song/artist rows are capped at eight. Identical in-flight requests share
one fetch; membership changes do not refetch the whole Home catalog. The active
All tab does not issue another fetch. SQL binds all IDs and limits, with a maximum
limit of 50. Existing unfiltered callers keep their previous behavior.

Home no longer uses featured endpoints that load the full persistence snapshot.
The public Supabase genres endpoint now also uses one small query, not a full
snapshot. The existing pooled connection and scheduled-release logic remain intact.
No schema/index migration or production timing benchmark was performed.

Lightweight static skeletons appear immediately; other successful rows remain
usable while a request is slow. A delayed loading message appears after five seconds.
Requests abort after twelve seconds. Retry requests only failed sections; refresh
can reload all sections. Home data never falls back to stale stored private songs.
The existing root startup/splash timeout is untouched.

## 11. Responsive tests

PASS production-export browser acceptance at 320x568, 360x800, 390x844, 768x1024
and 1280x900. Confirmed square bounded artwork, no document horizontal overflow,
artist-name navigation, exact genre filtering and genre URL refresh, direct Home
playback handoff, no unbounded Home requests, and no duplicate fetch from the All tab.
Phone/desktop screenshots were inspected. Controls use the existing mobile/web shell.
Remote artwork may load slowly: the existing TesoHub logo is now the neutral loading/
failure placeholder, not a fabricated cover. Successful images replace it normally.

## 12. Regression tests

- PASS 11 backend tests: query validation, strict public projection, bound SQL,
  legacy contract preservation, direct genres and existing private-song sharing rules.
- PASS 16 mobile unit tests: discovery selection/request handling plus existing
  onboarding and Smart Sharing tests.
- PASS guest, new registered listener, returning listener with history/likes/follows,
  stale private history, empty history/catalog, slow response, single-section failure,
  retry isolation, request timeout and failed-artwork browser scenarios. Home
  likes/unfollows update; failed artwork retains a rendered branded placeholder.
- PASS onboarding at 320/390/tablet/desktop, Skip/Start/reopen, dismissible account
  prompts, guest Support, shared-link bypass, incoming links and storage failure.
- PASS Profile/Library at 320/360/desktop: edit, Support, artist access, logout,
  hydration, like/unlike rollback, follow/unfollow/Undo/counts, playlists and reload.
- PASS Smart Sharing at 320/390/desktop: route refresh, copy/Web Share fallback,
  duplicate-share guard, playback handoff, artist menu, unavailable/private records,
  and public-only Artist Studio share actions.
- PASS whitespace and exported web backend-secret-pattern scan.
- PASS local Home with the real existing public catalog at 390px and 1280px,
  with screenshots of songs and featured artists. Actual guest audio advanced from
  Home for song 42; the play-count POST was intercepted, so the test did not update
  production listening counts. No account registration was required.

Automated account/API mutations use isolated fixtures, not production data.
SQL tests inspect captured queries/parameters with mocked database adapters; the
new queries have not been executed against production Supabase in this task.
Android hardware/emulator acceptance remains pending; no connected device was used.

## 13. Exports

PASS `npx expo export --platform web --platform android --output-dir dist-discovery-review`.
Final web bundle: `AppEntry-5221b1bd7416f332c012e3db730c73c1.js`.
Final Android bundle: `AppEntry-bd0f21474101fce119d399953aacc0b6.hbc`.
These are exports, not an APK build or publication.

## 14. OTA compatibility and preview

Mobile changes are JavaScript-only, use existing dependencies/assets, and remain
compatible with preview runtime/app version 1.0.6. No package name, SDK, native
configuration, permission, runtime or EAS channel changes.

Local preview: http://127.0.0.1:52251 . It uses the currently deployed public API,
which does not yet enforce the new bounded query options. The isolated browser
suite verifies those options with the new backend selection helper. This preview
is not a new public PWA deployment and is available only while its local server runs.

## 15. Remaining backend/release work

Review and approve first. Deploy the additive backend query/genre-read changes
before a future OTA/PWA publication to obtain the bounded payloads in production.
Validate those reads against Supabase after deployment. No migration is required.

A public album/release read API would be needed for genuine album cards and release
types; date-windowed play events/aggregation would be needed for genuine Trending.
Neither was invented here. Cross-device listening offsets/recommendations are also
outside scope. Existing private audio streaming and authorization are unchanged.

Some existing external Picsum artwork stalled in browser testing even though direct
HTTP reads returned 200. The new branded placeholder keeps these cards usable, but
does not repair external-host reliability. No artwork records were replaced.

## Reproduce locally

From `backend-js`: `node --test tests/discovery.test.js tests/song-sharing.test.js`.

From `mobile`:

```powershell
node --test scripts/test-discovery.cjs scripts/test-onboarding.cjs scripts/test-song-sharing.cjs
npx expo export --platform web --platform android --output-dir dist-discovery-review
node scripts/verify-discovery.cjs dist-discovery-review
node scripts/verify-onboarding.cjs dist-discovery-review
node scripts/verify-library.cjs dist-discovery-review
node scripts/verify-song-sharing.cjs dist-discovery-review
```

Browser suites require Playwright and Edge; set `PLAYWRIGHT_MODULE` to the installed
module path when it is not in this project's dependencies. No dependency installation
is required. Screenshots are in `%TEMP%/tesohub-discovery-review/` and the existing
onboarding/library/sharing review directories. `verify-discovery.cjs ... --preview`
starts a local static preview on an available port without running fixture tests.

## Release checkpoint: 2026-10-03

Backend-only commit `a41a53e` was pushed to master. Production now enforces the
new bounded queries, confirming the updated backend is serving requests.
No frontend commit, OTA update, or PWA release was published at this checkpoint.

Production checks passed:

- `/healthz`: 200, `persistence_backend: supabase`.
- Full public catalog: 43 songs, 15 artists, 14 genres.
- New/popular/featured/more song queries: limit 3 returns 3, with correct ordering
  and featured/popularity filters. Featured artists also respects limit 3.
- ID-filtered song/artist queries return only the two requested records; a missing
  song ID returns an empty array. These support history/followed-artist resolution.
- Private-storage public-song audio: HTTP 206, exactly 1024 bytes for the requested
  bytes 0-1023 range, with the correct Content-Range header.
- Existing Admin login, `/admin-api/me`, and `/admin-api/discovery`: 200.
- Unauthenticated listener `/api/auth/me/`: 401 as expected.
- Protected redacted export counts and fingerprints are identical before/after:
  5 listeners, 13 auth sessions, 2 likes, 6 follows, 2 playlists, 4 playlist-song
  relationships, 43 songs, 15 artists, 14 genres. Other exported collections and
  settings also match. No production content or engagement mutations were sent.
- Backend tests: 11/11; frontend discovery/onboarding/sharing unit tests: 16/16.

Measured payload reduction: new-song query with limit 3 dropped from 44,847 to
3,191 bytes (43 records to 3). Featured artists limit 3 dropped from 7,741 to
1,549 bytes (15 records to 3). Single observed genres request fell from 2,330ms
to 574ms; these are individual network observations, not a statistical benchmark.

RELEASE HOLD: successful existing listener login and authenticated `/api/auth/me/`
cannot yet be verified because test-listener credentials are unavailable. Admin
authentication is verified, but does not substitute for this listener check.
An existing test listener was requested using local `TESO_TEST_EMAIL` and
`TESO_TEST_PASSWORD` variables, without sharing secrets in chat. OTA/PWA remain
held under the requested backend gate. No new update/group ID exists.

Admin featured selections were read successfully, but no live feature toggles were
changed. Deployed frontend responsive/Home/regression verification remains pending
publication; previous local isolated tests must not be reported as live release tests.
Target remains preview/preview, runtime 1.0.6. No APK, native config, dependencies,
Supabase schema, migration or persistence-architecture changes were made.

## Release gate cleared: 2026-10-06

Existing-listener login, authenticated `/api/auth/me/`, and logout now return 200
using user-supplied local test credentials. No credentials or sessions are stored
in the repository or export. The backend query, private range streaming, genres,
and Admin authentication/discovery checks passed again. Catalog counts remain
43 songs, 15 artists and 14 genres. Changes in fingerprints since October 3 cannot
be attributed solely to deployment because the service remained live between runs.

The preview channel still maps to the preview branch and runtime 1.0.6. Fresh
Android and web exports passed with unchanged bundle hashes from the review:
`AppEntry-bd0f21474101fce119d399953aacc0b6.hbc` and
`AppEntry-5221b1bd7416f332c012e3db730c73c1.js`. All 27 unit tests passed again.
The discovery verification harness now also accepts `VERIFY_BASE_URL` for deployed
PWA testing; production API mutations remain intercepted in isolated UI scenarios.

Native configuration, dependencies, schema, migrations and catalog records remain
untouched. OTA publication precedes the frontend push that triggers the PWA deploy.
