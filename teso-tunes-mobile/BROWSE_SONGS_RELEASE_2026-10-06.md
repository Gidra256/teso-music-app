# Browse Songs release - 2026-10-06

## Published

- Frontend commit: `4879928e69c8acb383ab5169b3388f49fa1bc5e6`.
- GitHub master push completed; local HEAD and origin/master match.
- Android OTA update ID: `01a1117a-2b7a-73d0-83ad-b71242ee3c5d`.
- OTA group ID: `87c70e8b-2f52-458c-9626-5c1285ed3aae`.
- Channel and branch: `preview`; runtime and app version: `1.0.6`.
- Expo manifest endpoint returned HTTP 200 and the new update ID for Android,
  runtime 1.0.6, preview. Physical handset receipt remains unverified.
- PWA: https://tesohub-music-pwa.onrender.com/songs
- Render auto-deployment observed through the live HTML and new served bundle:
  `AppEntry-6c082f6799f4c5b9c4a783ff3792784a.js`.
- Live bundle contains the Browse list, song actions and correct production API.

## Included files

Paths below are relative to `teso-tunes-mobile/mobile`:

- `App.js`
- `src/screens/SongsScreen.js`
- `src/screens/HomeScreen.js`
- `src/screens/PlayerScreen.js` (Browse navigation target only)
- `src/components/SongCard.js`
- `src/components/SongActionsModal.js`
- `scripts/test-browse-navigation.cjs`
- `scripts/verify-browse-songs.cjs`

Songs now uses the existing navigation shell, with four visible mobile tabs,
Profile access, desktop sidebar, and mini-player above mobile navigation.
The song menu offers implemented Play/Pause, Like/Unlike, Add to Playlist,
Share and Go to Artist actions. Guest account actions retain the existing
friendly authentication prompt. Search/filter/list position survives mounted
in-app navigation; full reload persistence was not added.

## Verification

- Unit/native-adapter tests: 21 passed, zero failed.
- Android and web production exports passed before publishing. The tested
  Android export was published without rebuilding or native changes.
- Deployed PWA assets with isolated API fixtures: all seven combinations passed:
  guest at 320x568, 360x800, 390x844, 768x1024 and 1280x900; signed-in fixtures at
  390x844 and 1280x900.
- These checks cover direct /songs, refresh and Back, navigation/Profile access,
  search/filter/visible-row retention, menu/share/auth prompts, optimistic likes,
  duplicate prevention, rollback, playlist add/Create entry, browser-decoded
  fixture audio, mini-player placement and last-row clearance.
- The first cold browser run timed out at the 15-second refresh limit. The rerun
  used a 60-second navigation limit and disabled QUIC; it passed with no page
  errors. No local asset substitution was used. Asset delivery was slow on this
  connection (about 7.1 seconds for JS and 6.6 seconds for the icon font in a
  separate fetch). This does not establish load performance on other networks.
- Real production checks passed: Supabase health; private audio proxy HTTP 206
  for first and nonzero byte ranges; real guest playback/progress/pause/resume;
  paused tap seeking and playing drag seeking; backend sharing URL; Home New
  Releases/Popular/Genres/Featured/Continue Listening; history after reload;
  guest Profile and Help Center.
- Profile/Edit/Settings/shared-song/Support/Library document routes returned 200.
- PWA manifest parsed successfully and service worker returned JavaScript, both
  HTTP 200. Existing service worker uses network-first page navigation.
- Browser production writes, including play counting, were intercepted. No real
  listener login or account mutations were performed in this release pass.
  Signed-in action tests used isolated fixtures, not real user records.

## Boundaries and remaining checks

- No APK built; no native, dependency, backend, Supabase schema or catalog changes.
- Unrelated local backend changes and old migration files were left untouched.
- Physical Android update receipt, hardware Back, touch gestures, safe areas and
  native modal/share behavior still require a handset check.
- Installed-PWA update behavior on a physical device was not directly tested.
- Close and reopen the existing preview/runtime 1.0.6 Android app while online
  to allow its existing updater to download and apply this release.
- Refresh the public PWA to load the new release. A local preview URL is not the
  deployed application.

The earlier BROWSE_SONGS_REVIEW_2026-10-06.md describes the pre-publication review;
this report records the subsequent authorized release.
