# Smart Song Sharing

## Public URLs

Share `https://teso-music-app.onrender.com/song/{songId}`.
This existing backend route serves per-song Open Graph/Twitter metadata and
buttons to listen at `https://tesohub-music-pwa.onrender.com/song/{songId}` or
open `tesohubmusic://song/{songId}` in an installed app. The browser path does
not require installation. The static Expo page itself does not provide dynamic
per-song social metadata, so sharing the backend landing URL is intentional.

Configuration: mobile `EXPO_PUBLIC_SHARE_BASE_URL` controls shared links and
`EXPO_PUBLIC_MUSIC_WEB_URL` controls the web linking prefix. Backend
`PUBLIC_SHARE_BASE_URL` controls the canonical URL and `PUBLIC_MUSIC_WEB_URL`
controls the browser destination. Defaults retain the existing Render hosts.
Do not point the canonical URL at a new host until its `/song/:id` route serves
the metadata landing page. Native domain associations are separate from JS URL
configuration and are not changed by this release.

## Changed Files

- `backend-js/server.js`: published-only landing/detail guards; fast existing
  Supabase song lookup; unavailable response without persistence fallback.
- `backend-js/songSharing.js`: escaped, audio-free social metadata/landing HTML.
- `backend-js/tests/song-sharing.test.js`: metadata/security and real route
  handler tests with stubbed Supabase responses, including failure/no fallback.
- `mobile/App.js`: exact `/song/:id` screen; existing player at `/player`.
- `mobile/src/config/api.js`: configurable public URL bases.
- `mobile/src/api/musicApi.js`: fresh published-song lookup without local cache.
- `mobile/src/utils/shareLinks.js`: native/Web Share, copy fallback, result events.
- `mobile/src/components/SongShareModal.js`: verify, share, copy, errors and pending guard.
- `mobile/src/components/AddToPlaylistModal.js`: Share in existing song menus,
  including artist song lists. Compact cards keep their uncluttered layout.
- `mobile/src/screens/SongScreen.js`: exact song, artwork, play, artist, like,
  share, discovery and unavailable states; guest-readable links.
- `mobile/src/screens/PlayerScreen.js`: Now Playing uses the verified share sheet.
- `mobile/src/screens/ArtistStudioScreen.js`: share published/public releases only.
- `mobile/scripts/test-song-sharing.cjs`: native/web helper contract tests.
- `mobile/scripts/verify-song-sharing.cjs`: browser integration tests.
- This document.

## Behavior and Security

Share text is `Listen to {Song Title} by {Artist Name} on TesoHub Music` plus
the public song URL. Android/iOS use React Native Share. Web uses Web Share when
available and otherwise copies the link. A separate Copy Link action is available
on web, with visible confirmation. Native copy targets depend on the OS share sheet;
the URL is also selectable. Installed share targets decide whether they accept links.

Opening the share sheet verifies publication first; the next user tap invokes
Web Share directly to preserve transient user activation. A ref guards duplicate
share taps. Verification/network errors are visible; no cached unpublished song
is used to create a share. Both shared-page endpoints require published status.
No audio URL is included in share content or landing HTML. Private/signed artwork
is replaced by the public logo. HTML interpolation is escaped.

The existing lightweight console event mechanism now emits `song_shared` after a
successful API handoff/copy, with song_id, method, platform and ISO timestamp.
This is not a persistent analytics service and does not prove delivery to a contact.
Android's Share API does not reliably distinguish cancellation from sheet handoff.
Known web/iOS dismissals and failures are not logged as successful shares.

## Native Link Audit and OTA

Current app configuration has scheme `tesohubmusic` and Android HTTPS intent filter
for `teso-music-app.onrender.com/song`. The preview channel maps to preview branch,
runtime/app version 1.0.6. This release changes JS only, with no dependencies,
permissions, SDK, native configuration or APK build.

Live `/.well-known/assetlinks.json` returned 404 because
`ANDROID_SHA256_CERT_FINGERPRINTS` is not configured. Automatic Android HTTPS
opening therefore cannot be claimed verified. Configure the installed APK's real
signing fingerprint on Render and verify the device's association; no APK may be
needed if its embedded intent filter matches the current config. A different host
such as `music.tesohub.com`, or an APK missing the filter/scheme, needs a later
native build plus domain association. The installed APK was not physically inspected.

## Verification

- 5 backend tests and 7 sharing helper tests pass.
- Android and web production JS exports pass.
- Browser sharing checks pass at 320x568, 390x844 and 1280x900: exact route and
  refresh, copy/fallback, Web Share payload, duplicate taps, playback handoff,
  artist menu, unavailable/private records, and published-only Studio sharing.
- Existing Profile/Library regression suite passes at 320x568, 360x800 and
  1280x900, including likes/follows, Undo/counts, playlist creation/reload, account
  hydration and support/profile navigation.
- Integration API writes and media playback are mocked; no production accounts,
  music records, likes, follows or playlists are changed by tests.
- Production read-only baseline: Supabase health OK, 43 songs, 15 artists,
  private audio byte-range request returns 206 and audio/mpeg.
- Web production bundle passes backend-secret-pattern scan.

Device acceptance still needed: real Android share sheet, WhatsApp delivery and
preview rendering/cache, installed-app custom-scheme opening, and audible playback.
Browser playback tests verify the selected audio source reaches the existing player;
they do not substitute for listening on a phone. Social services control their
own preview cache and may not update old previews immediately.

## Reproduce Tests

From backend-js: `node --test tests/song-sharing.test.js`.
From mobile: `node --test scripts/test-song-sharing.cjs`, then export to
`dist-sharing-review` and run `node scripts/verify-song-sharing.cjs` and
`node scripts/verify-library.cjs dist-sharing-review`.
Set `PLAYWRIGHT_MODULE` to an installed Playwright module if not on the module path.
Set `VERIFY_BASE_URL` to the public PWA to repeat browser checks against deployment.
