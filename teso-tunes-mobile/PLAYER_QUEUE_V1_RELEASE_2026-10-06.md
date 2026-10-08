# Player Queue / Up Next V1 release - 2026-10-06

Status: Android OTA published, PWA deployed, and post-deployment verification
complete. All eight deployed-asset suites passed, with the Library suite rerun
after an initial screenshot/font-loading timeout.

## Release identity

- Commit: `0d8ab22b78ed4595a92ef6e66718f0add0ae3abc`
- Message: `Add Player Queue and Up Next V1`
- GitHub `master` confirmed at this commit after push.
- Android OTA update: `01a111bd-6e4d-7264-b1af-024c495f1a0e`
- OTA update group: `b6f3816a-01d5-4bc5-8c95-80f39d42da52`
- Channel and branch: `preview`
- Runtime and app version: `1.0.6`
- Expo creation time: `2026-10-06T15:03:09.645Z`
- Expo's Android/runtime/channel update endpoint returned HTTP 200 and served
  this exact new update ID.
- PWA: https://tesohub-music-pwa.onrender.com
- New PWA bundle observed at `2026-10-06T15:04:49.974Z`:
  `AppEntry-6f0ff19bffe65a8785aceb9683fbfbd4.js`.
- Render's existing GitHub-connected deployment delivered the new static site.
  Its live bundle contains the queue controls and the correct production API.
- `/player`, `/songs`, manifest and service worker return HTTP 200.

## Files in the commit

All paths are relative to `teso-tunes-mobile/mobile`:

- `src/utils/playbackQueue.js`
- `src/context/PlaybackQueueContext.js`
- `src/context/PlayerContext.js`
- `src/context/PlayerContext.web.js`
- `src/components/UpNextModal.js`
- `src/components/SongActionsModal.js`
- `src/components/SongCard.js`
- `src/components/AddToPlaylistModal.js`
- `src/screens/PlayerScreen.js`
- `src/screens/PlaylistDetailScreen.js`
- `scripts/test-playback-queue.cjs`
- `scripts/test-listener-player.cjs`
- `scripts/verify-playback-queue.cjs`
- `scripts/verify-listener-player.cjs`
- `scripts/verify-song-sharing.cjs`
- `scripts/verify-browse-songs.cjs`

No application feature was added or changed during release preparation. Two
browser test scripts gained a production-base-URL override. Temporary test
helpers and this release record are not part of the application commit.

## Pre-publication gates

- 31 automated unit/native-adapter checks passed, zero failures.
- All eight browser suites passed: Queue, Player, Browse Songs, Smart Sharing,
  Onboarding, Library, Profile/Edit/Settings and Discovery.
- Web production export passed: `dist-queue-review`, bundle
  `AppEntry-ecc1bd8a17cf75716450d7d50476a4f9.js`.
- Android production export passed: `dist-queue-android-review`, bundle
  `AppEntry-170f8aa7d4e88da8ab140938f4ebe7f7.hbc`.
- OTA published that tested Android export without rebundling.
- No native/configuration/package changes were staged or committed.
- Staged whitespace check passed.

## Post-deployment checks

### Real production services and audio: PASS

- `/healthz`: Supabase persistence remains active.
- Private music proxy: HTTP 206 and exact 1024-byte responses for first and
  nonzero byte ranges (`0-1023`, `4096-5119`).
- Real guest music playback, moving progress, pause/resume, paused tap seek and
  playing drag seek passed against the public PWA and backend.
- Real-song queue: Up Next, intentional duplicates with distinct entry IDs,
  move-up, remove, natural advance to another occurrence and Repeat Off stopping
  at the queue tail passed using public song 37.
- Real Home New Releases, Popular Songs, Genres, Featured songs/artists and
  genuine Continue Listening passed; history remained after reload.
- Backend shared-song URL returned HTTP 200; shared song played without signup.
- Profile/Edit Profile/Settings/Library/Support/shared-song routes return SPA
  documents; guest Profile and real Help Center passed.
- No uncaught browser errors in the real-service checks.
- Browser mutation requests, including play counts, were intercepted. Production
  account/catalog data was not changed for these tests.

### Deployed frontend with isolated API/account fixtures

Queue suite: PASS at 320x568, 360x800, 390x844, 768x1024 and 1280x900.
Verified current/upcoming display, Play Next, Add to Queue, deliberate duplicates,
rapid-action guards, remove/reorder/select, guest access, plain lyrics hydration,
natural completion with one/multiple entries, Repeat Off/All/One and visible
shuffle order. Actual source entry contexts passed: Home, Continue Listening,
Search, filtered Browse, Artist, Playlist, liked Library, compact Recently Played
and shared song.

Other deployed frontend suites: PASS.

- Player: 320, 360, 390, 768 and 1280px. Play/Pause, rapid commands,
  Next/Previous, tap/drag/keyboard seeking, playing/paused seeks, song switching,
  end/replay, repeat/shuffle, loading pause, buffering, errors/Retry and history.
- Browse Songs: all five widths for guests, plus phone/desktop listeners.
  Navigation shell, mini-player, direct routes/refresh/Back, state preservation,
  last-row reachability, song menus, account prompts and real decoded audio.
- Smart Sharing: 320, 390 and 1280px. Direct shared routes, reload, copy/fallback,
  Web Share, duplicate guards, playback handoff, artist navigation, private/missing
  songs and Studio visibility.
- Onboarding: 320, 390, 768 and 1280px, completion/Skip/reopen, shared-link bypass,
  guest prompts/dismissal, Support and failed preference-storage handling.
- Library: final standalone rerun passed at 360, 320 and 1280px. Like/Unlike with
  rollback, Follow/Unfollow/Undo/counts, playlist actions, account hydration,
  saved-state reload, Profile, Support, artist access and logout.
- Profile/Edit/Settings: all five widths; validation, failed save, duplicate
  guards, discard/cancel, identity sync, all artist states, Support/deletion
  handoff, guest gates, logout and overflow checks.
- Discovery: all five widths plus returning/new users, genuine empty catalog,
  slow/error/timeout and artwork-failure cases. Existing real sections and
  history remain intact; no fake content added.

Test boundaries: these suites load deployed HTML/JavaScript and intercept account
APIs to exercise mutations without changing real users. Player/Queue suites decode
fixture WAV audio. From the Player suite onward, identical static assets fetched
from the live PWA are reused in memory within each suite, avoiding repeated CDN
downloads; no local export JavaScript is substituted. Real-service checks above
also ran independently without this asset reuse. Real listener login was not
performed; authenticated behavior is verified with isolated account fixtures.

The initial aggregate deployed run passed seven suites but Library stopped at a
screenshot waiting for fonts, before completing its functional checks. A direct
live icon-font fetch returned HTTP 200, 389724 bytes in 2807ms. The test helper was
adjusted to fetch those exact deployed font bytes before browser launch; Library
then passed at every configured size with all assertions intact. Discovery used
the same prefetch. No app change was made to claim this as a production font fix;
intermittent cold asset delivery remains an observed verification caveat.

One extra real-queue test initially queried Up Next before the song menu finished
closing. Waiting for the menu to close fixed that test-only timing issue; the
rerun passed without app changes.

## Boundaries and remaining handset checks

- No new APK, native dependencies, Android configuration, permissions, SDK,
  package name, runtime version or app-version changes.
- No Supabase schema/persistence changes, migrations or production catalog edits.
- Existing unrelated backend/migration working-tree edits remain untouched and
  uncommitted; they were not deployed by this frontend commit.
- No synced lyrics, recommendations or other new release-time features.
- Queue/repeat/shuffle remain session-local and reset after a full app restart
  or page reload. Saved account data is separate.
- Still requires a physical Android handset: receipt/activation of this OTA,
  touch and hardware Back/modal behavior, background/lock-screen continuation,
  native audio transitions and native share sheet. Browser tests, native-adapter
  tests and exports do not prove these physical-device behaviors.
- Final read-only release probes again confirmed the exact new OTA is served,
  the new PWA bundle is served, and backend persistence remains Supabase.
