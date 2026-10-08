# TesoHub Music listener-experience release

Date: 2026-10-06. Released commit: `b9cc2b4ce4a44e78e5ef2367107d61256dab1d11`.

## Scope and preservation

Both completed workstreams are included: playback/interaction responsiveness and Profile/Edit Profile/Settings cleanup. No merge conflict or overwritten intended behavior was found. Profile/authentication duplicate guards survived the reorganization. Shared Support/playlist guards, engagement rollback, actual-clock progress, measured seeking, and genuine history remain present and tested.

No new feature was added in this release task. Only verification tooling was adjusted: Profile checks can target the public PWA, the performance test baseline is pinned to the actual pre-polish commit instead of moving HEAD, and a read-only production smoke test was added.

No APK build, native configuration, SDK/dependency, permission, package-name, runtime, backend, Supabase schema, persistence or catalog-data change. Unrelated local backend migration/script files were excluded from the commit and push. No appearance modes, photo uploads, usernames or listener-social features were added.

## Android OTA

- Update ID: `01a110fa-fed5-7d6c-bdcf-b15925cb6662`
- Update group: `3617c499-1c08-45a6-946e-137da09e6cef`
- Channel: `preview`, verified mapped to branch `preview`
- Runtime/app version: `1.0.6`
- Platform: Android only
- Published: `2026-10-06T11:30:47.125Z`
- Expo's update endpoint returned HTTP 200 and this update ID for Android / preview / 1.0.6. A second check confirmed it again.
- Published the already-tested export with skip-bundler, not an APK/native build.

The first manual manifest probe used protocol 0 and returned 406. Retrying with the supported multipart protocol 1 returned the new update correctly; this was a verification-request issue, not a failed OTA publication.

## PWA deployment

- URL: https://tesohub-music-pwa.onrender.com
- Pushed commit to origin/master; the existing Render Static Site rebuilt automatically.
- Previous bundle: `AppEntry-1b5bed85e64bea49db6a2e2d3e6ca278.js`
- New served bundle: `AppEntry-800d213ce2c05cd405988892b3e69f38.js`
- New bundle SHA-256: `6a2e1755c9e7c78df22d2ce103ef40db999e90ee681379046bd1b0e442ee27c7`
- Verified new Profile/Edit/Settings labels and player retry/progress controls in the served code, then exercised their UI.
- Render's generated bundle hash differs from the local export. Verification used the served bundle and actual browser behavior, not an assumed identical build hash.
- Production bundle contains none of the checked database URL, Supabase secret or backend-secret-variable markers.
- Profile, Edit Profile, Settings, song, Support and Library SPA documents return 200.
- PWA manifest parses correctly and service worker loads (HTTP 200); navigation is network-first.

## Final pre-release tests

All completed before publication:

- Android and web production exports passed into `mobile/dist-listener-release`.
- Android bundle: `AppEntry-9127a37ff285fe77b85b2dda17c65b7c.hbc`.
- Local web bundle: `AppEntry-a2849bfb3d849243661f656718ecd0b6.js`.
- `test-discovery.cjs`: 6 passed.
- `test-onboarding.cjs`: 3 passed.
- `test-song-sharing.cjs`: 7 passed.
- `test-listener-player.cjs`: native adapter/gesture/history/engagement scenarios passed. Twenty audio updates generated zero main-context rerenders, versus twenty for the fixed pre-polish baseline; progress consumers still updated twenty times.
- `test-profile-native.cjs`: Android/iOS keyboard-layout, preference, saving and duplicate-guard component checks passed.
- `verify-profile.cjs`: 320/360/390/tablet/desktop, validation, failed save, success, discard/cancel, duplicate save/logout, all artist states, deletion handoff, guest restrictions and short viewport scrolling passed.
- `verify-library.cjs`: Profile/authentication/Support actions, optimistic likes/follows, rollback, Undo/counts, playlist create/add/remove/rename/delete, reload reconciliation and all Library states passed.
- `verify-onboarding.cjs`: Skip/completion/reopen, guest prompts, shared-link bypass, guest playback, Support and unavailable storage passed.
- `verify-discovery.cjs`: five widths, real section rules, returning/new account states, empty/slow/error/timeout cases, artwork fallback and navigation passed.
- `verify-song-sharing.cjs`: direct routes/reload, copy/share, duplicate guard, playback handoff, artist menu, private/missing song behavior and Studio visibility passed.
- `verify-listener-player.cjs`: five widths with browser-decoded WAV, actual progress, rapid play/pause, next/previous, tap/drag/keyboard seek, playing/paused seek, song switching, end/replay, history/reload, repeat/shuffle, buffering pause and error/Retry passed.
- Live API preflight: 43 published songs, valid release dates/newest-first New releases, positive play-count Popular content, 14 genres, Supabase health, and private-storage proxy HTTP 206.
- Local release code playing real production audio passed actual-clock, pause/resume, tap/drag seek and Continue Listening checks, with production play-count writes blocked.

## Post-deployment production checks

Real production reads and real streamed audio, with all catalog/account mutations blocked:

- PASS: `/healthz` reports `supabase`.
- PASS: private music proxy returns HTTP 206 and exactly 1024 bytes for both `bytes=0-1023` and `bytes=4096-5119`.
- PASS: public shared song 37 resolves without onboarding or registration; backend share URL returns 200.
- PASS: actual audio clock advances and progress matches; pause/resume, tap seeking while paused and drag seeking while playing work.
- PASS: New releases, Popular songs, Genres, Featured songs/artists load.
- PASS: Continue Listening appears only after real playback and remains after reload.
- PASS: new guest Profile, Create Account/Log In choices and real Help Center load.
- PASS: protected-route SPA documents and manifest/service worker load.

The cold run completed those functional checks but recorded an icon-font `12000ms timeout exceeded` error, so its overall no-errors assertion FAILED. A warm-asset repeat passed all public checks with no browser errors. The repeat cached exact JS/font bytes fetched from this deployment; API/audio reads still went to production. It did not substitute local app code or synthetic music for the live app.

Deployed-asset tests with isolated account/API fixtures all completed successfully using the exact cached deployed assets:

- Profile/Edit Profile/Settings at 320/360/390/tablet/desktop: listener, guest, pending/rejected/changes-requested/approved artist, save/back/discard/logout, Settings, Support/deletion handoff and protected routes.
- Library at 320/360/desktop: account hydration/authentication, likes/unlikes, failure rollback, follows/unfollows/Undo/counts, playlist actions, reload reconciliation, Support submission/replies and artist access. Existing Downloads unavailable state remains.
- Onboarding at four widths: skip/start/completion/reopen, guest authentication prompts, shared-song bypass/playback, prior listening history and storage failure.
- Discovery at all five widths, plus new/returning accounts, empty catalog, slow/error/timeout/retry and artwork fallback.
- Smart Sharing at 320/390/desktop: route refresh, copy/Web Share/duplicate guard, player handoff, artist menu, private/missing songs and Studio visibility.

The post-deploy suite exited 0. No real account mutations were made. The final backend health recheck again returned HTTP 200 with Supabase persistence, and the OTA manifest recheck still served the released Android update.

## Remaining limits

1. Intermittent cold icon-font loading remains, also documented before this release. A separate uncached Profile test hit its 10-second navigation/screenshot timeout. Warm-asset tests distinguish application correctness from this asset-delivery issue; they are not proof the cold-loading issue is fixed.
2. No local TESO_TEST_EMAIL/TESO_TEST_PASSWORD was available. Real existing-account production login/auth-me/collection checks were NOT RUN. Authentication, account editing, likes/follows/Library, support conversations and artist roles were exercised with isolated fixtures, not production writes.
3. No physical Android device was connected/tested. Still check OTA receipt on the installed preview APK, rapid pause/seek on a real phone, keyboard/safe-area behavior, hardware Back, and background/lock-screen audio under battery restrictions. Native exports/component adapters are not substitutes for these device checks.
4. No production registration, artist uploads, support creation or engagement changes were made. Play-count requests during real listening tests were explicitly intercepted.

## Files included in commit (30)

All paths below are under `teso-tunes-mobile/mobile/`:

```text
App.js
scripts/audit-listener.cjs
scripts/test-listener-player.cjs
scripts/test-profile-native.cjs
scripts/verify-discovery.cjs
scripts/verify-library.cjs
scripts/verify-listener-live.cjs
scripts/verify-listener-player.cjs
scripts/verify-listener-release.cjs
scripts/verify-onboarding.cjs
scripts/verify-profile.cjs
src/components/AccountPage.js
src/components/AddToPlaylistModal.js
src/components/CreatePlaylistModal.js
src/components/MiniPlayer.js
src/components/PlayerTimeline.js
src/components/SeekBar.js
src/components/SongCard.js
src/context/EngagementContext.js
src/context/PlayerContext.js
src/context/PlayerContext.web.js
src/context/PlayerProgressContext.js
src/screens/EditProfileScreen.js
src/screens/PlayerScreen.js
src/screens/PlaylistDetailScreen.js
src/screens/ProfileScreen.js
src/screens/SettingsScreen.js
src/screens/SupportTicketDetailScreen.js
src/screens/SupportTicketFormScreen.js
src/utils/playerProgress.js
```

This post-release report and generated exports/evidence are local artifacts, not another deployment. Original local implementation reports remain historical snapshots of the pre-release work.
