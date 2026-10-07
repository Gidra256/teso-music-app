# Android Early Access and PWA parity release

Status: IN PROGRESS. Public APK checksum gate passed; final frontend checks and publication are in progress.

## Existing APK identity

- Source: `C:/Users/HP/Downloads/application-7d0ae182-fb29-47a0-8297-c548f30f7276.apk`.
- Asset filename: `TesoHub-Music-Android-v1.0.6.apk`.
- Package: `com.tesotunes.app`.
- Version name/code: `1.0.6` / `7`.
- EAS build: `7d0ae182-fb29-47a0-8297-c548f30f7276`.
- Build source commit: `b91986e119467e2fd4bbde2fa49008d7e93fd320`.
- Runtime: `1.0.6`; channel/branch: `preview`.
- Bytes: 80,332,111.
- APK SHA-256: `26c5a12153a6e761a62063832b1334df948a0a832e20ae327bf3eb7903a9b0b0`.
- Signing certificate SHA-256: `a0ccc8b3f01dbda77c73a822024b9255b87438edcd9b29e3f07df3cdc857ec7b`.
- Signature verified again with Android apksigner before upload. No APK bytes, signing credentials, package ID or native settings changed.

## Hosting

- Approved tag: `tesohub-music-android-v1.0.6` at the original APK build source commit, not the newer frontend commit.
- Release title: TesoHub Music Android - Early Access v1.0.6.
- Repository: existing public `Gidra256/teso-music-app`.
- Direct upload attempts failed on the slow connection; GitHub returned HTTP 408 at about six minutes with only part of the 80 MB transferred. A longer client timeout alone could not fix the server timeout.
- Resumable transport now uses 77 individually SHA-256-verified 1 MiB-or-smaller parts inside the same private draft release. Manual GitHub-side assembly verifies the full original SHA-256 before attaching the unchanged APK. Parts must be removed before publishing, after the final asset digest matches. No new hosting provider or APK build is used.
- Transfer workflow commit: `78baf3b`. Only `.github` deployment tooling was pushed; this does not change the frontend/native code. The public PWA bundle remained `AppEntry-6f0ff19bffe65a8785aceb9683fbfbd4.js` afterward.
- Public download verification: PASS. The laptop's full download timed out on the slow connection; an independent GitHub runner downloaded the entire public asset without authorization headers/cookies/token, received HTTP 200, verified APK ZIP bytes, 80,332,111 bytes and the original SHA-256. Workflow: https://github.com/Gidra256/teso-music-app/actions/runs/37615278386 (success). Local anonymous HEAD also returned HTTP 200 and a range download returned HTTP 206.
- Public release: https://github.com/Gidra256/teso-music-app/releases/tag/tesohub-music-android-v1.0.6
- Public APK: https://github.com/Gidra256/teso-music-app/releases/download/tesohub-music-android-v1.0.6/TesoHub-Music-Android-v1.0.6.apk
- Temporary transport parts were removed after hash validation. Only the full verified APK remains attached. Public verification workflow commit: `d90e555`.
- All 77 transport parts were uploaded and their individual hashes matched the original local APK. Interrupted upload placeholders were removed only for this draft's own temporary assets.
- GitHub assembly PASSED: https://github.com/Gidra256/teso-music-app/actions/runs/37609963779. Full assembled APK is 80,332,111 bytes and matches the original SHA-256. It was assembled from original bytes, not rebuilt or signed again.

## Frontend release

- Frontend commit: PENDING.
- OTA update/group: PENDING.
- OTA channel/branch: preview; runtime: 1.0.6.
- PWA: https://tesohub-music-pwa.onrender.com
- PWA deployment: PENDING.
- Final Android export passed (`dist-early-access-android-final`, bundle `AppEntry-644e8ad0a23f3a27c3f115661be15d5e.hbc`); no APK built.
- Final web export passed (`dist-early-access-final`, bundle `AppEntry-7abec0ac874447943e5aa07e672ac5b4.js`). Both exports were scanned for backend secret/connection-string markers; none found.
- Mobile unit/native regressions: 40 passed; all six backend unit suites: 30 passed, including Admin loading and empty playlist serialization. The initial directory-only test invocation was corrected to explicit test files on this Node version.
- Final install/parity browser tests passed with the verified URL at 320/360/390/768/1280 widths: confirmed/cancelled APK download, keyboard-visible Create, single submission, Android/iPhone/desktop actions, seven-day dismissal, standalone hiding, manifest/icon dimensions, real service worker and Chromium installability diagnostics (no errors).
- Real production login/auth-me and final local PWA playlist CRUD passed. Separate authenticated sessions verified cross-session visibility in both directions; only temporary test playlists/sessions were removed, and the original playlist was unchanged.
- All nine final browser suites passed: install/parity, onboarding, Profile, discovery, Library, queue, listener player, Browse Songs, and Smart Sharing. These use intercepted fixture APIs for behavioral regressions; production API checks are identified separately.
- Preflight web export passed (`dist-early-access-preflight`, bundle `AppEntry-b4d6a2ecc160b3b510d432abc8057d9d.js`). All nine local browser suites passed on this source before configuring the verified public download URL. Download-destination integration and deployed checks remain separate release gates.

## User-facing behavior

- Get Android App confirms an Android Early Access APK download, explicitly says it is not Google Play, and mentions Android's expected browser/files installation permission. Cancel does not download. Android security warnings are not bypassed.
- Open App explicitly attempts the existing Android scheme with exact supported content and a matching web fallback. It does not claim to detect native installation.
- The reused APK contains an older embedded JavaScript bundle. Its original source includes automatic Expo update download/reload and the existing custom scheme. Fresh installs need an online first launch to receive the current preview OTA, particularly for newer playlist deep links. Cold-start/first-update behavior still needs a physical-phone check.
- Install Web App uses browser installation or manual guidance. Seven-day dismissal and standalone detection remain intact.
- iPhone/iPad receive Safari Add to Home Screen guidance and no Android download button. Desktop receives PWA installation/manual guidance.
- One configurable public distribution destination can later point to Google Play without changing the UI.
- Central frontend setting: `ANDROID_DOWNLOAD_URL` in `mobile/src/config/api.js`, overridden with `EXPO_PUBLIC_ANDROID_DOWNLOAD_URL` (legacy store override retained). No Render secrets or backend credentials are included in this setting.
- The production playlist API was checked again: create empty playlist/listing count 0, add/remove, rename/delete all pass; original existing playlist preserved; health remains Supabase.

## Boundaries

- Only isolated, named test playlists and test-created auth sessions may be created/removed for production verification. Existing playlists, catalog and engagement records are preserved.
- A truly zero-playlist listener account remains unavailable in the local environment; no existing playlist is deleted to manufacture that state. Empty playlist objects and authenticated CRUD are tested separately.
- Physical Android installation/update, warm/cold exact-content intents, no-app fallback, Android/PWA cross-device UI synchronization, and actual OS installation on Android/iOS require handset checks.
- No new APK, native configuration/signing change, Supabase schema change or production music catalog edit.
