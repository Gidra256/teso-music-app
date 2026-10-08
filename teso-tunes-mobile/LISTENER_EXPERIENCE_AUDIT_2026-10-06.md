# TesoHub Music Listener Experience Audit

Date: 6 October 2026

Status: implemented and tested locally. NOT committed, pushed, published through OTA, or deployed to the PWA. No APK was built. Supabase schema, persistence, production catalog, backend routes, native configuration, and app dependencies were not changed by this work.

Local review: http://127.0.0.1:57813

The public PWA remains https://tesohub-music-pwa.onrender.com. It does not contain these unpublished changes yet.

## 1. Home Sections Found

Read-only production audit at 10:47 UTC, plus browser checks of the deployed PWA and the local production export using the live API.

All sections below already exist. No new discovery section or synthetic content was added.

| Section | Production response / displayed | Visibility and filtering |
| --- | --- | --- |
| Continue listening | Fresh guest: no history request / 0 | Hidden without eligible history. Requests the first 6 locally recorded IDs, reconciles against published backend songs, preserves history order, displays up to 3 rows. |
| New releases | 16 / 8 | Visible. Unique published songs with release_date in YYYY-MM-DD format, not in the future, sorted newest first and limited to 8. |
| Popular songs | 16 / 8 | Visible. Published songs with positive stored play_count, sorted descending. Removes overlaps with New releases; if that removes everything, retains up to 3 genuinely ranked songs. |
| Featured artists | 7 / 7 | Visible. Keeps only returned artists marked is_featured. Backend request limit is 8. |
| Genres | 14 / 14 | Visible. Removes empty/non-string entries and duplicate labels; no production labels were removed. |
| Artists you follow | Fresh guest: no request / 0 | Hidden when logged out or no eligible followed IDs exist. Requests at most 8 account-followed IDs and rejects returned artists outside that set. Full followed collection remains in Library. |
| Featured songs | 8 / 8 | Visible. Unique published songs marked is_featured. Backend limit 12; display limit 8. |
| More to discover | 16 / 4 | Visible. Excludes songs already used by New, Popular, Featured, or the reconciled recent set. In the fresh-guest audit, 12 returned items were removed by these rules. |

## 2. Why Sections Look Missing

- Continue listening and Artists you follow are intentionally absent for a fresh guest, not broken public-catalog requests.
- Featured songs, Genres, and More to discover are farther down the page; they are not all in the first phone viewport.
- Song/artist sections hide when their post-filter item list is empty. Existing loading skeletons remain while their requests are pending.
- Failed requests leave that section empty and show the existing failed-section Retry control. Other sections continue loading independently.
- No permanent production-data/filter issue hiding a populated section was reproduced. One live run timed out waiting for More to discover; a subsequent diagnostic run passed all five widths without retry. The earlier transient's cause was not established.

## 3. New Releases Production Data

The public catalog returned 43 songs: all 43 published, all 43 with valid calendar release dates, and no future dates. The New releases response was newest-first; its newest date was 2026-03-15.

The current Home implementation is song-based, using each song's release_date. It is not a separate album/release-object carousel. This existing product behavior was preserved.

Popular uses stored backend play counts only. No Trending calculation or invented popularity was added.

Production genres: Ateso Traditional, Teso Gospel, Gospel, Afrobeats, Amapiano, Dancehall, Reggae, Hip hop / Rap, R&B, Kadongo Kamu, Cultural / Folk, Instrumental, Other, Not sure.

## 4. Continue Listening Behavior

Before: native playback recorded a song after requesting Play, and web recorded it after play() resolved. Neither required demonstrated clock advancement.

Now: a song is recorded only when the current audio engine reports playing and its position advances. Native ignores buffering and pending seek states; web requires available audio data and ignores seeking. Pressing Play, a failed load, or moving the slider alone does not create history.

History keeps the latest 30 distinct songs, with the newest listened song first. Writes are serialized, and late initial cache loading cannot overwrite a newer listening action. Home reconciles history with the public catalog, excluding removed/private songs.

It persists locally across reload/restart and is not reset by login. This is existing device/browser-local history, not cross-device account synchronization or saved resume-position functionality. Older stored history was not deleted or rewritten retroactively.

## 5. Files Changed

Application files:

| File | Change |
| --- | --- |
| [PlayerContext.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/context/PlayerContext.js>) | Native playback ordering, seek coordination, genuine history, buffering/errors, progress isolation. |
| [PlayerContext.web.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/context/PlayerContext.web.js>) | Browser playback ordering, actual-clock sampling, Media Session actions, genuine history, retry/error state. |
| [PlayerProgressContext.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/context/PlayerProgressContext.js>) | New small progress subscription context and stable action delegates. |
| [playerProgress.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/utils/playerProgress.js>) | New bounded progress snapshot store. |
| [SeekBar.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/components/SeekBar.js>) | Stable native gestures, web pointer capture, preview/commit/cancel, accessibility. |
| [PlayerTimeline.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/components/PlayerTimeline.js>) | New leaf component for progress/time rendering. |
| [MiniPlayer.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/components/MiniPlayer.js>) | Isolated progress rendering and labeled 44dp playback target. |
| [PlayerScreen.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/screens/PlayerScreen.js>) | Timeline integration, buffering/retry feedback, larger small controls, consume linked-song request once. |
| [EngagementContext.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/context/EngagementContext.js>) | Authoritative counts, nonblocking cache writes, visible cross-platform error notice. |
| [SongCard.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/components/SongCard.js>) | 44dp song-menu target. |
| [CreatePlaylistModal.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/components/CreatePlaylistModal.js>) | Synchronous duplicate-submission guard. |
| [AddToPlaylistModal.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/components/AddToPlaylistModal.js>) | Duplicate guard; retry a failed add without recreating the successfully created playlist. |
| [PlaylistDetailScreen.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/screens/PlaylistDetailScreen.js>) | Mutation guard, working web delete confirmation, labeled playlist actions. |
| [ProfileScreen.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/screens/ProfileScreen.js>) | Duplicate login/register/save/logout guard and comfortable small touch targets. |
| [SupportTicketFormScreen.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/screens/SupportTicketFormScreen.js>) | Duplicate submission guard, 44dp category/priority/back/remove-attachment targets. |
| [SupportTicketDetailScreen.js](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/src/screens/SupportTicketDetailScreen.js>) | Duplicate reply guard, closed-state guard, back/remove-attachment targets. |

Verification files:

- [audit-listener.cjs](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/scripts/audit-listener.cjs>): new read-only catalog/date/health/private-media audit.
- [test-listener-player.cjs](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/scripts/test-listener-player.cjs>): new real-React render, isolated native audio/gesture and engagement tests.
- [verify-listener-player.cjs](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/scripts/verify-listener-player.cjs>): new production-export browser tests with real decoded WAV audio and isolated APIs.
- [verify-listener-live.cjs](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/scripts/verify-listener-live.cjs>): new live-catalog browser audit with all production writes blocked and explicit retry diagnostics.
- [verify-discovery.cjs](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/scripts/verify-discovery.cjs>): simulated playback fixture now reports advancing audio, matching the stricter history rule.
- [verify-library.cjs](<C:/Users/HP/Documents/teso music app/teso-tunes-mobile/mobile/scripts/verify-library.cjs>): expanded rapid-tap, error/rollback, playlist CRUD, Support submission/reply and login/register checks.

This report and the untracked dist-listener-review export are also new. Existing unrelated backend script/migration changes and earlier review exports were left alone.

## 6. Interaction Improvements

- Removed playback's old 180/250ms busy windows that discarded commands.
- Likes/follows still update optimistically, with their existing per-item synchronous request locks. Failed operations roll back and now display a small dismissible message on web as well as native.
- Successful counts use the backend's value even when it is lower than the optimistic estimate. Optimistic counts are no longer artificially preferred over the server.
- Local engagement-cache writes no longer delay the request or count update; queued writes preserve their order.
- Playlist, authentication, Profile, and Support mutations acquire their locks before the first await, preventing same-frame double submissions.
- Web playlist Delete now opens a real browser confirmation; the existing native confirmation is preserved.
- Existing TouchableOpacity press feedback, keyboard-aware layouts, navigation, styling, sharing feedback and artist Unfollow/Undo remain.

## 7. Player Improvements

Play/pause responds to the latest intent, without waiting for a catalog/API round trip. Old asynchronous play results cannot overwrite a newer pause or song selection. Superseded native loads cannot create a second player; previous audio and listeners are released when switching.

Replay, repeat, next/previous, and shuffled Next were checked. A queued native end/repeat action cannot override a newer pause. Linked-player navigation no longer reopens the original linked song after Next/Previous.

The full player displays buffering and a useful Retry state on failure. Browser Media Session Play and Pause now execute their explicit actions instead of both toggling.

## 8. Progress Bar

- Uses actual engine currentTime/duration. Web samples the audio element on animation frames; native receives 100ms audio status updates. Neither extrapolates an artificial playback clock.
- Measures rendered width; tap/drag uses the correct track coordinates instead of child-thumb/fill coordinates.
- Shows position and elapsed-time preview during drag, then sends one seek on release. Cancellation does not seek.
- Native responder identity survives progress/handler rerenders. Web uses pointer capture and also supports arrow keys, Home and End.
- Unknown/zero duration disables seeking; positions are bounded to duration.
- Song changes unmount the old timeline and cancel its pending gesture.
- Native seeks coalesce overlapping requests and ignore stale pre-seek positions while the engine catches up.

## 9. Measured Performance

Using the actual React provider and an isolated Expo audio adapter, 20 separate audio-position updates produced:

| Consumer | Before, HEAD implementation | After |
| --- | --- | --- |
| Main player-context consumer, equivalent to Home's subscription | 20 renders | 0 renders |
| Progress consumer | 20 renders | 20 renders |

Only the timeline and mini progress fill subscribe to frequent progress snapshots. Stable action identities also prevent linked-song effects from repeating as playback state changes.

Home's existing bounded discovery calls and in-flight request deduplication remain. Read-only production samples were approximately 0.67-2.30 seconds per discovery endpoint on the latest audit; these are individual network samples, not a database benchmark or a claim of backend optimization.

## 10. Android Results

PASS: Android production export and isolated native-provider tests for rapid commands, delayed initialization, one live player, stale seek statuses, coalesced seeks, replay/repeat/shuffle, end/pause races, errors/retry, and genuine history.

PASS: native gesture tests for measured width, drag preview, single commit, cancellation, changing callbacks/status, song changes, and unknown duration.

NOT RUN: physical Android handset playback, native keyboard, background-audio and lock-screen tests. The adapter tests do not substitute for those checks.

## 11. Web/PWA Results

PASS at 320x568, 360x800, 390x844, 768x1024 and 1280x900: actual browser-decoded audio, play/pause, rapid toggles, tap/drag/keyboard seeking, beginning/end seeking, paused/playing seeks, next/previous, one active stream, natural end/replay, history/reload, and responsive layout without horizontal page overflow.

PASS additionally at 390px: repeat, shuffle, pause during delayed audio loading, failed audio load and Retry.

PASS: live catalog Home checks at 320, 360, 390, 768 and 1280px, on both the deployed site audit and the local implementation. The final diagnostic local run needed no retry at any width. Actual live guest audio advanced and history survived reload. All mutation requests, including play-count requests, were intercepted in these tests.

An earlier live More-to-discover timeout remains noted in section 15; it was not silently counted as a successful run.

## 12. Regressions

PASS:

- 6 discovery unit tests; 3 onboarding unit tests; 7 sharing unit tests.
- Fresh guest, empty/new account and returning account fixtures; real/public history reconciliation; all discovery sections; empty/slow/failed/timed-out section responses; retry and artwork fallback.
- Rapid like/unlike and follow/unfollow, rollback messages, Undo, authoritative lower counts, multiple artist isolation, and removal persistence after reload.
- Playlist create/add/remove/rename/delete, with one request per rapid double tap.
- Profile editing, Library collections, logout, artist application/Studio navigation.
- Login/register and Support create/reply duplicate guards, using isolated API fixtures rather than production account creation.
- Onboarding completion/skip, shared-link bypass, guest listening, friendly account prompts, dismissal/back navigation and storage failure handling.
- Smart Sharing copy/fallback/Web Share, duplicate-share guard, direct route/reload, unavailable/private fixtures and playback handoff.
- Production /healthz returned 200 and persistence_backend: supabase.
- Production private-audio proxy for published song 42 returned 206, audio/mpeg, bytes 0-1023/6238432. No storage permission or backend streaming code changed.

## 13. Production Exports

PASS: npx expo export --platform web --platform android --output-dir dist-listener-review

- Web: AppEntry-7965b54ad72b26ed214410ba0e6ce7a1.js
- Android: AppEntry-884e4456ae969079bbaed61bffac040e.hbc

Test-catalog strings and fixture credentials were checked absent from the web bundle. git diff --check passed for mobile changes. Temporary React test tooling was installed outside the app; app package files were not changed.

## 14. OTA Compatibility

JavaScript-only and compatible with the configured preview channel/runtime 1.0.6. App version remains 1.0.6; runtimeVersion remains the existing appVersion policy. No native dependency, permission, SDK, package name, Android configuration, or EAS configuration changes were made. No new APK is required for these edits.

No OTA ID exists for this work because publication was explicitly withheld.

## 15. Remaining Issues / Release Checks

1. Physical Android verification is still required, especially touch seeking, keyboard reachability on a small handset, and background/lock-screen playback.
2. A fresh production listener-login test was not run: TESO_TEST_EMAIL and TESO_TEST_PASSWORD are absent from the local process/User environment. Authenticated flows were tested with isolated fixtures; production account contents were not modified.
3. One earlier live More-to-discover load timed out. The subsequent diagnostic run passed all five widths without retry; the intermittent cause was not established. Existing bounded loading/error/retry behavior remains, and no backend/network reliability change is claimed.
4. 42 of the existing 43 song records reference picsum.photos artwork; one uses the backend host. Branded fallback artwork appeared in live screenshots. These existing catalog URLs were not replaced, consistent with the no-catalog-edits constraint.
5. Changes are local only. The public PWA and installed APK will not show them until a separately authorized OTA/PWA release.

Evidence: C:/Users/HP/AppData/Local/Temp/tesohub-listener-review (player/live screenshots and live-results.json), tesohub-listener-audit.json, and the existing discovery/library/onboarding/sharing review screenshot folders in the same Temp directory.
