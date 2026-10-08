# PWA installation and playlist release gate

Frontend publication remains ON HOLD. No OTA, PWA publication, APK build or APK upload was performed for this request.

## Backend deployment

- Pushed backend-only commit `83d80c8` (`Fix empty playlist serialization in Supabase responses`). Only `backend-js/supabasePersistence.js` and `backend-js/tests/empty-playlists.test.js` were included.
- Production behavior verifies Render is serving the fix: authenticated playlist listing with a newly created empty playlist returns HTTP 200 and `song_count: 0`, not HTTP 500.
- Root cause: summary rows use `songs = null`; the former `row.song_count || songs.length` dereferenced null for a zero count. The fix preserves authoritative zero with `row.song_count ?? songs?.length ?? 0`.
- Live API create/add/remove/rename/delete passed. The original playlist summaries were compared before/after and were unchanged.
- Real touch-browser PWA login, authenticated `/auth/me`, create/add/remove/rename/delete passed against the existing production API. Independent authenticated sessions observed each other's playlist changes. This verifies shared account persistence, not physical Android UI behavior.
- Temporary test playlists were deleted and only test-created login sessions were logged out.
- `/healthz` reports `persistence_backend: supabase`.
- A listener with genuinely zero playlists is still a separate PENDING production check. Current available credentials belong to an account with one existing playlist. `TESO_EMPTY_TEST_EMAIL` / `TESO_EMPTY_TEST_PASSWORD` were not available in Process, Windows User or Machine environment when checked. No existing playlist was removed to manufacture an empty account. The zero-list SQL/serialization case passes locally.
- Subsequent unrelated Admin commits appeared in the shared repository during this work. They were not reverted or included in the playlist commit; this report does not claim those changes as part of this task.

## Recovered APK and public download audit

- Recovered file: `C:/Users/HP/Downloads/application-7d0ae182-fb29-47a0-8297-c548f30f7276.apk`.
- EAS build: `7d0ae182-fb29-47a0-8297-c548f30f7276`; Android preview, app/runtime 1.0.6, versionCode 7, package `com.tesotunes.app`.
- Size: 80,332,111 bytes. APK signature verification passed.
- File SHA256: `26c5a12153a6e761a62063832b1334df948a0a832e20ae327bf3eb7903a9b0b0`.
- Signing certificate SHA256: `a0ccc8b3f01dbda77c73a822024b9255b87438edcd9b29e3f07df3cdc857ec7b`.
- The original EAS artifact `https://expo.dev/artifacts/eas/lWmJiCx1ytZOrwGpoQkcPhjk3T_FY49AytUKJszTvUM.apk` returns HTTP 404 after redirect. It is NOT configured as a download target.
- EAS build details still load, but a build detail page is not a working APK download. Recorded artifact expiry was September 8, 2026.
- Existing GitHub repository `Gidra256/teso-music-app` is public; its releases list was empty. No approved working public APK URL was found. Configured download URL: NONE.
- Recommended next step, subject to approval: upload this exact signed APK as a versioned Early Access release asset in the existing repository. Do not commit the APK into source or use an expiring signed link. Record the file checksum alongside the release.
- GitHub Releases support distributable binary assets: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases

## Three separate actions

| Action | Behavior |
| --- | --- |
| Install Web App | Uses the captured browser `beforeinstallprompt` only on a user click; when unavailable, opens platform-appropriate manual installation guidance. It never downloads an APK. |
| Get Android App | Only appears on Android when an approved HTTPS distribution URL is configured. Opens that exact build-time configured destination only after a user click. Currently hidden because no working approved URL exists. |
| Open App | Explicit Android intent using existing `tesohubmusic` scheme and `com.tesotunes.app`. Song/artist/playlist/release paths are retained. The browser fallback is the exact PWA route with `app_fallback=1`. No automatic launch and no claim that native installation can be reliably detected by the browser. |

- Android compact Home prioritizes Get Android App when configured, otherwise Open App. An available browser install prompt also exposes Install Web App. Full controls are available on shared-content pages and Settings.
- iPhone/iPad: Add to Home Screen guidance via Safari Share; no Android download/open actions.
- Desktop: Install Web App or manual browser installation guidance; no Android actions.
- Dismissal persists for seven days. An installed/standalone PWA does not show the PWA installation suggestion. Settings is an intentional manual entry point.
- Continue on Web dismisses the suggestion without interrupting listening or moving away from the shared content.
- Existing playlist privacy is unchanged: a shared private playlist still requires the owning account. A shared URL does not grant access.
- The held-local backend song landing uses the same Open App / Get Android App wording and hides Android actions on non-Android devices. Legacy artist/playlist redirects also remain local, not included in the deployed serializer fix.

## Configuration and Google Play readiness

- Set `EXPO_PUBLIC_ANDROID_DOWNLOAD_URL` on the PWA build only after verifying an approved public download destination. It is blank/unset now.
- `EXPO_PUBLIC_ANDROID_STORE_URL` is the existing fallback setting. Later either use the canonical download setting for an approved Google Play listing, or unset it and set the existing store setting. Download takes precedence when both are set.
- The backend landing's matching public option is `ANDROID_DOWNLOAD_URL`, with `ANDROID_STORE_URL` as fallback. Those landing changes have not been deployed.
- No runtime/query-string/API-provided location selects the APK destination. Only public build/deployment configuration is used; unsafe schemes and URLs with embedded credentials are rejected.
- Keep database URLs, Supabase secrets and private audio URLs out of these public settings.
- No Play listing was invented or integrated. Replacing the configured distribution URL does not require a UI redesign.

## Verification

- Mobile unit/native regression checks: 39 passed.
- Backend serializer/discovery/sharing regression checks: 18 passed.
- Browser parity checks passed at 320, 360, 390, 768 and 1280px: touch input focus, reduced visual viewport, reachable Create, Enter submission, guest prompts, exact shared song, artist/playlist routes, manual install, browser event, dismissal persistence, standalone hiding and iPhone-only guidance.
- One initial responsive run timed out during navigation; a complete diagnostic rerun passed all widths without changing product behavior.
- Real Chromium manifest validation and installability diagnostics report no errors. Real service worker ready; actual icon dimensions match declared 192px and 512px.
- Manifest name TesoHub Music, short name TesoHub, ID/start/scope `/`, display standalone.
- Web export passed: `mobile/dist-install-actions-review`, bundle `AppEntry-8c3dd11a040f0633f7573928054bc977.js`.
- Android production export passed: `mobile/dist-install-actions-android-review`, bundle `AppEntry-1ced344089f433395c250fd570916ee0.hbc`. This is an export, not an APK build.
- Web bundle uses the public Render API. Pattern scan found no database/Supabase secret credentials.
- Public PWA still serves its previous bundle `AppEntry-6f0ff19bffe65a8785aceb9683fbfbd4.js`, HTTP 200.
- Live health/private audio checks passed: Supabase, HTTP 206 for first and nonzero byte ranges. Real guest audio clock, pause/resume and paused/playing seek passed.
- Repeated live Home check: PASS New Releases, Popular, Genres, Featured artists/songs, real Continue Listening across reload and guest Profile/Help Center. An initial run timed out waiting for Continue Listening; the complete rerun passed without product changes. Catalog/engagement writes were blocked during this read/audio verification.
- All nine browser suites passed: onboarding, PWA parity/install, Profile/Edit/Settings, Home/Discovery, Library/engagement, Queue, player, Browse Songs and Smart Sharing. Includes guest prompts, authenticated fixture playlist actions, likes/follows/rollback, repeat/shuffle/completion, support entry points and artist access. No claim is made that an automated browser fixture replaces physical Android testing.

## Files changed for this continuation

- Deployed: `backend-js/supabasePersistence.js`, `backend-js/tests/empty-playlists.test.js`.
- Local install controls: `mobile/src/components/AppAccess.web.js`, `mobile/src/utils/appAccess.js`.
- Held-local share landing: `backend-js/songSharing.js`, `backend-js/tests/song-sharing.test.js`, `backend-js/tests/playlist-parity.test.js`.
- Verification: `mobile/scripts/test-app-access.cjs`, `mobile/scripts/verify-pwa-parity.cjs`, `mobile/scripts/verify-live-playlists.cjs`, `mobile/scripts/verify-playlist-deployment.cjs`.
- This report. Earlier local playlist keyboard/route, manifest/icons, service worker and screen integration changes are retained; see the previous parity review for their full inventory.
- Unrelated migration/script changes were left untouched.

## Remaining gates

1. Approve hosting the recovered APK as an Early Access GitHub release, or provide another approved working public destination. Nothing has been uploaded.
2. Verify the truly zero-playlist test account once its credentials are available locally.
3. Complete physical-device checks: Android app installed/not-installed exact-content launch/fallback, cold/warm app, real Android/PWA playlist sync and keyboard, real PWA native installation, and iOS Safari Add to Home Screen.
4. Review implementation/report and explicitly approve frontend publication after these gates. Frontend remains unpublished while the APK URL is unresolved.

Local preview: http://127.0.0.1:59210 (not the public PWA).

No Supabase schema, production music catalog, native configuration, APK build, OTA publication or PWA publication changes occurred in this task. JavaScript/web-asset work remains compatible with preview runtime 1.0.6.
