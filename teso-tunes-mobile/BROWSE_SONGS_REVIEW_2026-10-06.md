# Browse Songs local review

Status: implemented locally; not committed, pushed, or published. No APK built.

## Cause and navigation fix

Songs was registered as a root stack screen outside MainTabs. Opening it covered
the mobile tab bar, while its header replaced Profile with Back whenever history
existed. The desktop shell already wrapped the root stack.

Songs now lives inside the existing tab navigator as a route without a visible
tab button. The only visible tabs remain Home, Search, Your Library, and Create.
The existing desktop sidebar and topbar are unchanged. Mobile Songs keeps both
Back and the Profile avatar. Home and Player entry points target the nested route.

The public path remains /songs. Direct entry and refresh work with the existing
SPA rewrite; no hosting or backend route changes are necessary. Tab history
handles normal returns. Android hardware Back falls back to Home only when
Browse has no navigation history; its listener is removed when Browse loses focus.

## Listener behavior

- Guests can browse, search, filter, play public songs, and share.
- Guest Like/Add to Playlist/Create use the existing Profile invitation with
  Create Account, Log In, and Keep Listening. Cancelling returns to Browse.
- Signed-in listeners use existing engagement and playlist APIs. Create opens
  the existing playlist creation form, not another type of creator workflow.
- The menu offers Play/Pause, Like/Unlike, Add to Playlist, Share, and Go to Artist
  when an artist ID exists. No unavailable actions are offered.
- Like/Unlike keeps the existing optimistic state, pending-request guard,
  authoritative count handling, and failed-request rollback.
- Songs stays mounted when switching tabs or opening Player, Profile, or an artist.
  Search, category, and the current list area survive those transitions.
- The existing mini-player now sits inside the scene above the tab bar. Its
  Play/Pause and full-player entry still work. Existing list bottom padding
  leaves the final song visible above the mini-player.

## Files

Application changes:

- mobile/App.js
- mobile/src/screens/SongsScreen.js
- mobile/src/screens/HomeScreen.js
- mobile/src/screens/PlayerScreen.js (Browse navigation target only)
- mobile/src/components/SongCard.js (optional menu handler)
- mobile/src/components/SongActionsModal.js (new)

Focused tests:

- mobile/scripts/test-browse-navigation.cjs (new)
- mobile/scripts/verify-browse-songs.cjs (new)

This review document and local export directories are generated review artifacts.
Pre-existing unrelated working-tree changes were left untouched.

## Verification

The final unit/native-adapter run passed 21 top-level tests across:
test-browse-navigation, test-discovery, test-onboarding, test-song-sharing,
test-listener-player, and test-profile-native.

Browse browser coverage uses an isolated API and real browser-decoded test audio:

| Viewport | Guest | Signed-in listener |
| --- | --- | --- |
| 320 x 568 | Passed | Covered separately at 390 |
| 360 x 800 | Passed | Covered separately at 390 |
| 390 x 844 | Passed | Passed |
| 768 x 1024 | Passed | Covered separately at 1280 |
| 1280 x 900 | Passed | Passed |

Checks include direct /songs entry, refresh, Home-to-Songs Back, browser Back,
profile access, four visible mobile tabs, desktop shell, search/category retention,
horizontal filters, menu actions, guest prompts, share URL, native-clock browser
playback, mini-player pause, final-row clearance, and retaining the visible song
area when returning from Player or another tab. Signed-in tests include optimistic
Like/Unlike, rapid-tap suppression, failure rollback, Add to Playlist, and Create.

All six existing browser regression suites passed against the final web export:

- verify-onboarding: fresh/returning state, completion/skip, shared links, guest prompts.
- verify-library: likes/follows/Undo/counts, failed-request rollback, playlists,
  account hydration, reload persistence, Support, artist access, and logout.
- verify-profile: Profile/Edit/Settings, validation/errors, all artist states,
  account gates, Support, and layout.
- verify-song-sharing: direct/reloaded links, native/web sharing helpers,
  guest playback handoff, artist navigation, unavailable songs, Studio visibility.
- verify-listener-player: actual browser audio, rapid commands, seek gestures,
  next/previous, repeat/shuffle, completion/replay, buffering/error/Retry, history.
- verify-discovery: responsive Home, authentic history, section content,
  empty/slow/failed requests, retry, and artwork failures.

API mutations in these tests were intercepted by fixtures, not sent to production.
Screenshots are in the Windows temporary folder under tesohub-browse-review.

## Exports and compatibility

- Web export: passed, mobile/dist-browse-review.
  Bundle: AppEntry-27bb1d93125096e42d769728e3af53ef.js.
- Android export: passed, mobile/dist-browse-android-review.
  Bundle: AppEntry-ff1bb78c9c3e2f6a4e05a1da7427cd4c.hbc.
- JavaScript-only, compatible with the existing preview channel/runtime 1.0.6.
- App version, native configuration, dependencies, Supabase schema, backend APIs,
  playback implementation, and production catalog data were not changed.
- No OTA, PWA deployment, or APK build was performed.

Local preview: http://127.0.0.1:55177/songs (this laptop only).

## Remaining checks and boundaries

- Physical Android touch gestures, system Back, safe-area behavior, keyboard, and
  native modal/share-sheet transitions still need a handset check. Router,
  component/native-adapter tests and Android export are not physical-device QA.
- The tested phone/tablet layouts are browser viewports, not an installed PWA
  or a fresh device build. Production/service-worker rollout is deliberately pending.
- Browse state is retained during the mounted session. A full reload or account
  transition can reset search/filter state; no new persistent preference was added.
- Existing virtualized-list measurements may settle after returning; tests confirm
  the previously visible final song stays accessible rather than requiring identical
  intermediate pixel offsets.
