# TesoHub Music: PWA parity and installation review

Local implementation only. No commit, push, backend deployment, OTA, PWA deployment or APK build was performed.

## Playlist failure: three confirmed causes

1. The create, add-to-playlist and rename sheets wrapped inputs in a tap handler that dismissed the keyboard. A mobile-touch browser reproduction showed the name input losing focus immediately after tapping it. Removed that wrapper and retained the outside dismiss area.
2. A direct `/create` visit rendered an empty tab placeholder. It now opens the existing creation form for an authenticated listener. Guests reach the existing account invitation, with Keep Listening returning to Library instead of reopening the invitation.
3. Real production testing found that a newly created empty playlist makes `GET /api/playlists/` fail with HTTP 500. `listPlaylists()` serializes summaries with `songs = null`; `row.song_count || songs.length` dereferences null when the count is zero. The local fix uses `row.song_count ?? songs?.length ?? 0`, preserving an authoritative zero. No SQL/schema change is needed.

The third fix is NOT deployed. Production empty-playlist listing remains a release blocker until an approved backend deployment and a repeat of the isolated live test.

## Implemented behavior

- Playlist creation, adding/removing songs, renaming and deleting continue to use the existing authenticated account API. No browser-only playlist storage was added.
- Shared `KeyboardSheetViewport` uses native KeyboardAvoidingView on Android/iOS, and the real `visualViewport` height/offset on web. Existing safe-area padding and scrollable forms remain. No keyboard or screen-height constants were added.
- Existing synchronous request guards and Enter/Done submission remain intact. The song-menu creation form also keeps focus and submits once.
- Guest playlist actions use the existing account invitation; direct private playlist visits explain that sign-in is required and offer Keep Listening.
- A compact Home install row, persistent Settings install access and reusable shared-content Open/Install controls were added without replacing the app shell or music controls.
- Song sharing retains its existing backend URL and metadata. Artist/playlist share helpers now target the PWA; legacy backend artist/playlist links receive exact-route redirects after backend deployment.
- Existing playlist ownership remains enforced. Sharing a private playlist URL does not make its contents public or accessible to another account.

## Android and download boundary

- Native Android configuration, Expo SDK, dependencies, package name, app version, runtime policy and channel were not changed.
- App version/runtime: **1.0.6**. Intended OTA channel/branch remains **preview**. Frontend changes are JavaScript/web assets only.
- Explicit Open in App uses the installed build's existing `tesohubmusic` scheme, package `com.tesotunes.app`, and exact song/artist/playlist path through an Android intent.
- Intent browser fallback retains the exact PWA content path. No automatic app-launch attempt occurs on page load.
- Native installation is not guessed using a timeout. The button is an explicit attempt to open the installed app, not a claim that installation was detected.
- Automatic verified HTTPS Android App Links are not present in the previously audited installed APK. Adding those would require native configuration and a new APK; that separate change was NOT made. The explicit button does not require a new APK.
- **Configured public APK/Play download URL: none.** No fake store URL or temporary EAS artifact was substituted.
- A future approved HTTPS download target can be supplied as `EXPO_PUBLIC_ANDROID_DOWNLOAD_URL` for the PWA. `EXPO_PUBLIC_ANDROID_STORE_URL` remains supported. The backend song landing accepts `ANDROID_DOWNLOAD_URL` or `ANDROID_STORE_URL`. These are public distribution links, never backend secrets.

## Installation handling

- Captures `beforeinstallprompt` and invokes its native prompt only after a user click. An event is consumed once; duplicate clicks are guarded.
- Hides install promotion in standalone mode, after `appinstalled`, or after a recorded installation. A fresh browser installability event can clear stale installation state after uninstall.
- Remembers dismissal for seven days, including browser-prompt dismissal. Settings remains an intentional manual entry point. Dismissing installation does not remove Open in App from Android shared-content pages.
- Unsupported browsers receive manual Add to Home Screen/Add to Dock guidance rather than an inactive Install button.
- Manifest now has a stable ID and real 192px/512px logo assets matching the declared dimensions. The old icon was 1254px despite declaring 512px. Name, short name, root start URL and standalone display remain appropriate.
- Service worker includes the new icons and registers in secure contexts, including loopback previews. API/private media exclusions remain unchanged.
- Official references: [Chrome Android intents](https://developer.chrome.com/docs/android/intents), [MDN PWA installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## Verification

| Check | Result |
| --- | --- |
| Mobile unit/native regression checks | PASS: 38 tests |
| Backend playlist/sharing/discovery tests | PASS: 15 tests |
| Touch input, Enter, keyboard viewport, direct Create, install dismissal/standalone, manual help, exact routes | PASS: 320x568, 360x800, 390x844, 768x1024, 1280x900 |
| Manifest/icon dimensions and real service worker | PASS |
| Normal-profile browser installability diagnostics | PASS: no errors (incognito deliberately excluded from install eligibility) |
| Real listener login and `/api/auth/me/` | PASS |
| Real PWA playlist create/add/remove/rename/delete | PASS using isolated test playlists |
| Independent signed-in session sees PWA-created playlist by ID | PASS using the same API contract used by Android |
| Independent session creates playlist; PWA opens it by ID | PASS |
| Real empty-playlist collection listing | FAIL on current production backend; null-count fix implemented/tested locally, awaiting approved deployment |
| Test cleanup | PASS: temporary playlists removed, original playlist IDs unchanged, test-created sessions logged out |
| Physical Android-to-PWA and PWA-to-Android UI synchronization | PENDING: no Android device attached; API/session checks are not a handset test |
| Android production export | PASS; no APK built |
| Web production export | PASS |
| Exported web API URL / secret-pattern scan | PASS: expected public Render API, no backend credential patterns found |
| Real backend health and private audio proxy | PASS: Supabase health, HTTP 206 for first and nonzero byte ranges |
| Real guest playback/Home/Support against Render API | PASS: audio progress, pause/resume, seeking, genuine history, real discovery and Help Center; play-count writes blocked |
| Final onboarding, Profile/Settings, discovery and Library browser regressions | PASS |
| Final comprehensive browser regression run | PASS: all nine suites (onboarding, PWA parity, Profile, discovery, Library, queue, player, Browse Songs, song sharing) |

Final exported bundles: web `AppEntry-d171f9f7de4b2dd0eec00b42959d4ed5.js`; Android `AppEntry-1ced344089f433395c250fd570916ee0.hbc`. Local test total: 38 mobile/unit/native checks plus 15 backend tests. The separate live playlist smoke test correctly reports a failing gate for the undeployed empty-playlist listing fix; it is not counted as fully passed.

Browser install prompt mechanics were exercised with controlled install events. Real browser manifest/service-worker eligibility was checked separately. Actual operating-system installation and Android app launch still need device validation.

## Files changed

Paths below are relative to `C:/Users/HP/Documents/teso music app/teso-tunes-mobile`.

Backend:
- `backend-js/supabasePersistence.js`: one-line null-safe playlist count serialization.
- `backend-js/server.js`: legacy share-route redirects and public download URL option.
- `backend-js/songSharing.js`: exact Android intent, web fallback and optional approved download CTA.
- `backend-js/tests/playlist-parity.test.js`: new count/ownership/routing regression tests.
- `backend-js/tests/song-sharing.test.js`: updated fixed-script safety and handler fixtures.

Frontend:
- `mobile/App.js`: direct Create flow and secure-context service worker registration.
- `mobile/src/components/KeyboardSheetViewport.js`: shared keyboard-aware layout.
- `mobile/src/components/CreatePlaylistModal.js`: preserve input focus.
- `mobile/src/components/AddToPlaylistModal.js`: preserve focus, scroll creation form, guest guidance.
- `mobile/src/components/AppAccess.js`: native no-op component.
- `mobile/src/components/AppAccess.web.js`: reusable web controls.
- `mobile/src/utils/appAccess.js`: install controller, URL validation and exact-content intents.
- `mobile/src/utils/shareLinks.js`: PWA artist/playlist links and browser sharing/copy support.
- `mobile/src/screens/HomeScreen.js`: compact install entry.
- `mobile/src/screens/SongScreen.js`: shared-song app controls.
- `mobile/src/screens/ArtistDetailScreen.js`: shared-artist app controls.
- `mobile/src/screens/PlaylistDetailScreen.js`: keyboard handling, guest state, fallback Back and app controls.
- `mobile/src/screens/SettingsScreen.js`: manual install entry.
- `mobile/public/manifest.webmanifest`
- `mobile/public/service-worker.js`
- `mobile/public/icons/tesohub-192.png`
- `mobile/public/icons/tesohub-512.png`

Tooling:
- `mobile/scripts/generate-web-icons.cjs`
- `mobile/scripts/pwa-test-server.cjs`
- `mobile/scripts/test-app-access.cjs`
- `mobile/scripts/test-song-sharing.cjs`
- `mobile/scripts/verify-pwa-parity.cjs`
- `mobile/scripts/verify-live-playlists.cjs`
- This review report.

Existing unrelated edits to `backend-js/scripts/apply-supabase-schema.js`, old migrations and prior release artifacts were left untouched.

## Review and remaining gates

- Final exports: `mobile/dist-pwa-parity-verified` and `mobile/dist-pwa-parity-android-verified`.
- Review preview: `http://127.0.0.1:49809`. This is local, not a deployment. It uses the existing Render API, whose empty-playlist listing bug remains until the backend fix is approved for deployment.
- After approval: deploy the narrow backend fixes first, repeat live empty/nonempty playlist listing and cross-session CRUD, then release the PWA and compatible frontend OTA. No migration is required.
- On physical Android: verify installed-app intents for song/artist/playlist (cold and warm app), no-app fallback, real keyboard create/add/edit forms, native PWA installation, installed hiding and cross-device playlist synchronization.
- Verify manual installation in iOS Safari and production HTTPS after the approved web deployment.
- No production music catalog changes, Supabase schema changes, native configuration changes, APK build, OTA publication or PWA publication occurred.
