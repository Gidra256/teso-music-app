# Profile cleanup: local implementation and test report

Date: 2026-10-06. Local only. No commit, push, OTA, PWA deployment, APK build, backend changes, schema changes, or production data writes were performed for this task.

## 1. Files changed in this task

Paths below are relative to `teso-tunes-mobile/`:

- `mobile/src/screens/ProfileScreen.js`: account gateway, guest choices, artist/status section, Settings/Support links and bottom logout. Removed inline editing, technical identifier and inline playback switch.
- `mobile/src/screens/EditProfileScreen.js` (new): supported account fields, validation, guarded saving, feedback and unsaved-change protection.
- `mobile/src/screens/SettingsScreen.js` (new): playback, account information, support-based deletion request and About/version.
- `mobile/src/components/AccountPage.js` (new): shared keyboard-aware, safe-area account layout and accessible navigation rows.
- `mobile/App.js`: signed-in EditProfile and Settings routes, `/profile/edit` and `/settings`.
- `mobile/src/screens/SupportTicketFormScreen.js`: accept optional subject prefill for a deletion request. No submission is triggered by opening it.
- `mobile/scripts/verify-profile.cjs` (new): isolated browser acceptance checks at all five requested widths.
- `mobile/scripts/test-profile-native.cjs` (new): Android/iOS component logic checks with isolated adapters.
- `mobile/scripts/verify-library.cjs`: adapt existing regression checks to dedicated editing and renamed guest/logout actions.
- `mobile/scripts/verify-onboarding.cjs`: adapt existing guest-prompt assertions to the new copy.
- This report.

Earlier uncommitted listener/player work and unrelated backend migration-script changes were preserved. A full working-tree diff includes that earlier work; it is not all part of this task.

## 2. Old signed-in layout

Back / Profile -> initials, name, USER id and header logout icon -> Settings heading / background switch -> Help & Support -> inline Edit Profile form / Save profile -> artist access or application status -> floating mini-player.

## 3. New signed-in layout

Back / Profile -> initials, Listener/Artist identity, display name and Edit Profile -> ARTIST section with role-specific access/status -> ACCOUNT section with Settings and Help & Support -> Log out -> floating mini-player when applicable.

No music collections, listener social statistics, usernames, profile-photo controls or invented activity were added. Identity wraps on narrow screens, and content width is constrained on larger screens.

## 4. Edit Profile

- Dedicated route: `/profile/edit`, registered for authenticated accounts only.
- Profile name, Email and Phone use the existing account update API.
- Validation matches existing required-field rules: name at least two characters; email or phone required. Backend duplicate-account and other errors are displayed without claiming success.
- Save Changes is disabled when unchanged or saving. A synchronous ref prevents repeated submissions, including a Done-key/button combination. Fields are locked while saving.
- Saving... and Profile saved. feedback; successful response refreshes displayed values and shared account identity. Failed saves retain the draft.
- Back navigation supports cancel/discard for unsaved changes. React Navigation removal protection covers stack removal; web also registers a before-unload warning, subject to browser restrictions.
- Android uses KeyboardAvoidingView height, iOS padding, safe-area layout and scrollable content. Save remains in the scroll flow rather than a fixed keyboard-obscured footer. Drag dismisses the keyboard; Done can submit where the keyboard provides it.

## 5. Settings

- PLAYBACK: native Play in background switch calls the existing player preference setter, with duplicate-tap guard and update/error feedback.
- On web, the old switch only stored a value and did not enforce playback behavior. Settings now explains that background playback is managed by the browser/device and does not show a nonfunctional switch.
- ACCOUNT: Account information opens Edit Profile.
- PRIVACY & DATA: Request account deletion opens the existing support form, prefills Account deletion request and does not automatically submit or delete anything. Listeners use Account / Login; artists/pending artists use the existing Other category, since their category list does not include Account / Login.
- ABOUT: existing logo, About TesoHub Music, a brief description and version from app.json (1.0.6).
- No dead Terms/Privacy links: no supported legal document routes were found.

## 6. Artist behavior

Listener -> Become an Artist -> existing application screen.

artist_pending or pending application -> Artist Application / Under Review, informational only.

Rejected or changes_requested -> clear status, available review reason, accessible Edit or reapply action -> existing application screen.

Approved artist role -> Artist Studio -> existing Studio. Existing branch precedence and desktop Studio shortcut are preserved. No Studio functionality or artist follower counts were removed or moved into listener Profile.

## 7. Guest behavior

Identity icon / Make TesoHub yours -> short account-benefits message -> Create Account / Log In choices -> Keep Listening -> Help & Support.

Account fields only expand after choosing Create Account or Log In. Existing authentication APIs and duplicate guards remain. Success returns Home. Keep Listening returns to the prior screen or Home. Guests have no Settings, editor, artist application or logout controls; direct protected URLs do not expose account controls. Public listening remains available.

## 8. Technical identifiers

Removed USER id, device-ID fallback and SYNCING from visible Profile. Internal account IDs and API identifiers are unchanged.

## 9. Logout

A clearly labelled, 48dp-high Log out action is near the bottom. The existing logout/session-clearing flow is preserved, with a ref guard and busy state. It returns Profile to its guest choices; it does not introduce a confirmation dialog or music-data deletion.

## 10. Support duplication finding

Submit a Support Request and Contact Support still both open SupportTicketForm (`/support/new`) with the same authentication gate. One of these two tiles can safely be removed or consolidated later at the UI level; neither has a unique contact workflow. They were not changed here. Help Center, requests, conversations and categories remain intact.

## 11. Appearance architecture audit

`mobile/src/theme.js` exports one static dark `colors` object. Screens import it directly and construct styles at module scope; additional colors/gradients are hard-coded. There is no theme provider, selected-theme preference or system-color-scheme subscription. App configuration fixes userInterfaceStyle to dark and the app status bar is light.

System/Dark/Light was therefore not exposed. Correct implementation needs semantic light/dark tokens, a stored preference plus system-scheme resolution, reactive styles throughout the app, navigation/player/modal/form and status-bar coverage, replacement of hard-coded backgrounds, and contrast/accessibility verification in every theme. Native launch/system appearance settings would need a separate compatibility review if changed. Nothing in that larger theme conversion was attempted here.

## 12. Profile and platform tests

- PASS: exported web UI at 320x568, 360x800, 390x844, 768x1024 and 1280x900; screenshots captured and representative phone screenshots visually inspected.
- PASS: Profile links/collection exclusions, all supported editable fields, required-field validation, server-error display, unchanged account after failed save, successful save, immediate identity update, duplicate-submit prevention, cancel/discard, logout guard and guest authentication gates.
- PASS: all artist statuses and application/Studio navigation; support/deletion handoff for listener and artist, with no automatic request submission.
- PASS: reduced-height (330px) browser viewport checks that fields and Save can each be scrolled fully into view. This is a scroll-layout check, not a physical keyboard test.
- PASS: Android and iOS component adapters confirm safe-area/keyboard layout, existing playback setter, pending switch guard, Done submission, locked fields while saving and unsaved-state transitions.
- NOT DEVICE-VERIFIED: Android/iOS keyboard animations, native back/swipe behavior and real background audio under OS/battery restrictions. These still need a physical-device or emulator check before release.

All account/support/engagement API operations in acceptance tests were intercepted with isolated fixtures. No real account was created or changed and no production music data was written.

## 13. Regressions

- PASS `test-onboarding.cjs`: 3 tests.
- PASS `test-discovery.cjs`: 6 tests.
- PASS `test-song-sharing.cjs`: 7 tests.
- PASS `test-listener-player.cjs`: native audio adapter/state/seek/history and engagement guards.
- PASS `verify-library.cjs`: login/register, Profile editing, Support submission/replies, artist access, likes/unlikes/failure rollback, follows/unfollows/Undo/counts, playlist create/add/remove/rename/delete and reload persistence; 320/360/desktop.
- PASS `verify-onboarding.cjs`: four responsive sizes, skip/completion/reopen, guest account prompts, public song links/playback, Support and storage-failure handling.
- PASS `verify-discovery.cjs`: five widths, new/returning listeners, Home discovery/navigation, empty/slow/error catalog cases and artwork fallback.
- PASS `verify-song-sharing.cjs`: three widths, copy/native-share fallback, direct routes/reload, playback handoff, artist menu and Studio visibility.
- PASS `verify-listener-player.cjs`: five widths with browser-decoded test WAV; pause/resume, seek, rapid taps, next/previous, replay, history, repeat/shuffle and retry.
- PASS final `verify-profile.cjs` on the final export, including protected direct routes and reduced-height checks.
- PASS whitespace/diff check. Existing native/player code was not modified by this task.

## 14. Production exports

- Web: `npx expo export --platform web --output-dir dist-profile-review`, exit 0. Bundle `AppEntry-a2849bfb3d849243661f656718ecd0b6.js`.
- Android: `npx expo export --platform android --output-dir dist-profile-android-review`, exit 0. Bundle `AppEntry-c60547119e97b9620c45027c3c493087.hbc`.
- Native dependencies, app.json, eas.json and package lock were unchanged. Browser test tools were used outside the app dependencies.
- Local preview: http://127.0.0.1:54863/profile (temporary local server, not a deployment).

## 15. OTA compatibility

These changes are JavaScript/UI only and compatible by configuration with preview channel, app version 1.0.6 and appVersion runtime policy resolving to 1.0.6. No new native package, permission, SDK, package-name or Android configuration change; no new APK is required for this work. No OTA was published. Installed-device reception was not tested in this local-only task.

## 16. Backend/schema and pending work

No backend, API contract, authorization, Supabase persistence or schema changes were required. Existing production data was left untouched. Remaining work is device verification and user review; release remains explicitly withheld.
