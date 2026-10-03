# First-Time Onboarding: Release Verification

The implementation and pre-release checks below were completed before release.
Publication is now authorized for preview runtime 1.0.6 and the existing PWA.
No new APK is required. Deployment identifiers and post-deployment results are
reported separately after publication.

## Files Changed

- `mobile/App.js`: signed-out startup defaults to Home; navigation-aware onboarding
  receives the resolved current route, including cold and incoming shared links.
- `mobile/src/components/FirstTimeOnboarding.js`: single welcome screen using the
  existing logo, dark/neon colors, safe areas, scrollable content and fixed action area.
- `mobile/src/utils/onboarding.js`: local preference key, existing-use recognition
  and eligibility rules.
- `mobile/src/screens/ProfileScreen.js`: friendly account explanation and a
  dismissible guest experience; removes misleading "Login to listen" copy.
- `mobile/src/components/SongCard.js`: explicit square compact artwork dimensions
  so Home discovery tiles do not expand to intrinsic image height on web.
- `mobile/scripts/test-onboarding.cjs`: shared onboarding decision unit tests.
- `mobile/scripts/verify-onboarding.cjs`: production-export browser integration tests.
- `mobile/scripts/verify-library.cjs`: regression coverage for leaving the guest
  Profile after logout and suppressing repeated onboarding.
- This report.

Unrelated pre-existing backend migration/script changes were left untouched.

## Flow

One screen: Welcome to TesoHub Music, Discover Music, Build Your Library, and
Support Teso Artists, using the requested copy. Start Listening and Skip both
lead to the existing Home. No carousel, signup requirement, artificial delay,
or new discovery data. Existing featured songs/artists and discovery sections
remain backed by the existing API.

The local AsyncStorage key `tesohub_music_onboarding_v1` records `completed`,
`skipped`, or `existing-user`. Signed-in accounts and devices with genuine saved
account/listening/engagement history skip onboarding. A newly generated device ID
is deliberately not treated as evidence of prior use. Completion survives reloads
and is not cleared on logout. No backend onboarding preference/schema was added.

Shared `/song/:id` arrivals bypass onboarding and retain artwork/title/artist/play.
Navigating into a shared song while the welcome screen is visible dismisses it.
It will not pop up later in that session when the visitor goes to Home. Listening
also takes priority over a late local-preference read. A shared-link bypass is not
falsely recorded as completing the welcome screen.

Public listening is available without an account. Existing Like, Follow, and
Create Playlist guards still route guests to the account form, now explaining:
"Sign in or create an account to save likes, follow artists and keep your playlists
across devices. You can listen to public songs without an account."
Back and Keep listening return to the previous screen (including the shared song),
or Home if there is no previous screen. Account-only operations remain protected;
no permissions, auth APIs, or account data synchronization logic changed.

## Tests

- PASS: Android and web production exports.
- PASS: 3 onboarding unit tests and 7 existing song-sharing helper tests.
- PASS: onboarding browser suite at 320x568, 390x844, 768x1024 and 1280x900.
- PASS: first launch, Skip, Start Listening, local completion persistence/reload,
  useful Home discovery and onscreen primary action with no horizontal overflow.
- PASS: logged-out Like, Follow, Library playlist creation and main Create actions
  show the account explanation without issuing account-specific writes.
- PASS: guest Help & Support remains reachable.
- PASS: fresh shared-song arrival, Like prompt/back to song, guest playback handoff,
  discovery without delayed onboarding, and incoming shared-route navigation.
- PASS: existing guest history suppresses onboarding without changing history.
- PASS: failed preference storage does not block Home/listening.
- PASS: sharing regression suite at 320x568, 390x844 and 1280x900, including copy,
  Web Share, published-only Studio sharing and private/missing-song states.
- PASS: Profile/Library regression suite at 320x568, 360x800 and 1280x900, including
  account hydration, likes/unlikes/rollback, follows/unfollows/Undo/counts, playlist
  creation/reload, Profile editing, Support, artist access and logout.
- PASS: production web bundle backend-secret-pattern scan and git whitespace check.

Browser API writes and playback are mocked in integration tests; production
Supabase data is not changed. Android code compiles and the shared state logic is
unit-tested, but a fresh native installation, Android Back, font scaling, TalkBack
and physical keyboard behavior still need device acceptance. ADB is installed but
no device/emulator was attached during this task. The welcome screen has no text
inputs; existing Profile keyboard-aware layout remains in place.

## OTA Compatibility and Limitations

JS-only changes using existing dependencies and logo. App version/runtime remains
1.0.6; preview build channel remains `preview`. No native config, permissions,
SDK, package name, dependencies, persistence architecture or schema changed.
Approved for Expo OTA and PWA deployment after review.

Local-only preferences do not follow anonymous guests across devices. Clearing app
or site storage resets onboarding. Existing guests with no saved history may see
the welcome once. If local storage is unavailable, the app fails open to listening;
if saving completion fails, it can reappear on a later launch. No account prompt
silently performs a like/follow/playlist action on behalf of the user after login.

## Reproduce

From `mobile`:

```powershell
node --test scripts/test-onboarding.cjs scripts/test-song-sharing.cjs
npx expo export --platform web --platform android --output-dir dist-onboarding-review
node scripts/verify-onboarding.cjs
node scripts/verify-song-sharing.cjs dist-onboarding-review
node scripts/verify-library.cjs dist-onboarding-review
```

Browser scripts need Playwright with an Edge installation. Set `PLAYWRIGHT_MODULE`
to the module's path when it is not available through the normal Node module path.
Set `VERIFY_BASE_URL=https://tesohub-music-pwa.onrender.com` to repeat the browser
suites against deployed frontend assets; API writes remain intercepted.
