# TesoHub Music MVP Status

## Current Working Features

- The active mobile app is in `mobile/` and is an Expo React Native app.
- The active music backend is in `backend-js/` and uses Express.
- The main API file is `backend-js/server.js`.
- The legacy Django backend remains in `backend/` for reference and import support, but it is not the main backend currently used by the project.
- The backend serves public artist and song APIs.
- The backend includes a local admin dashboard at `/admin`.
- Admin users can create, update, and delete artists.
- Admin users can create, update, and delete songs.
- Artist photos, song cover images, and song audio files can be uploaded through the JavaScript backend.
- The mobile app can show Home, Songs, Artists, Search, Artist Detail, and Player screens.
- The mobile app can play songs through the current player context.
- The mobile app supports a mini player, full player, repeat, shuffle, seek, lyrics display, likes, and follows.
- Song and artist deep links are already configured in the mobile app.
- The backend exposes `/api/hub/search-documents/` so the main TesoHub website can discover music songs and artists.
- The main TesoHub website can use music documents from the backend in public search and preview flows.

## Current Backend

The current backend is `backend-js/server.js`.

It uses:

- Express for the API server.
- Multer for uploads.
- A JSON file database at `backend-js/data/db.json`.
- Local uploaded files under `backend-js/uploads/`.
- Static file serving for uploaded media at `/uploads`.
- Legacy media serving from `backend/media` at `/media`.

Current data storage is file-based JSON. This is useful for local development and a small pilot, but it is not strong enough for a serious public launch without backups, locking strategy, migration support, and deployment planning.

Current artist structure includes:

- `id`
- `name`
- `category`
- `bio`
- `photo`
- `location`
- `is_featured`
- `created_at`

Current song structure includes:

- `id`
- `artist`
- `title`
- `audio_file`
- `cover_image`
- `genre`
- `lyrics`
- `play_count`
- `release_date`
- `is_featured`
- `created_at`

Images and audio can be handled in two ways:

- As direct URL strings entered into the admin fields.
- As uploaded files stored locally by the backend.

Likes and follows are currently handled by device-based action records:

- Song likes are stored in `songLikes`.
- Artist follows are stored in `artistFollows`.
- The API supports like, unlike, follow, and unfollow actions.

Play counts exist on songs as `play_count`, but the current mobile player does not appear to call a backend endpoint to increment play count when a song starts playing. This needs to be added for the real MVP.

The backend already exposes the TesoHub website search integration through:

```text
GET /api/hub/search-documents/
GET /api/hub/search-documents/?q=term
```

That endpoint maps songs and artists into TesoHub search documents with:

- `music_track` documents for songs.
- `music_artist` documents for artists.
- Public preview URLs.
- `tesohubmusic://song/:id` and `tesohubmusic://artist/:id` app deep links.
- Absolute image URLs where possible.
- Popularity scores based on play count, likes, follows, and song count.

## Current Mobile App

The current mobile app entry point is `mobile/App.js`.

The app uses React Navigation with:

- Home
- Songs
- Artists
- Search
- Player
- Artist Detail

The app already imports Expo linking support and configures:

```text
Linking.createURL("/")
tesohubmusic://
```

The linking configuration supports:

- `home`
- `songs`
- `artists`
- `search`
- `song/:id`
- `artist/:id`

The current API layer is in:

```text
mobile/src/api/musicApi.js
mobile/src/config/api.js
```

The current API base URL is configured in `mobile/src/config/api.js`. The app falls back to local fallback data when the backend is unavailable, which is good for development but must be clearly treated as fallback/demo behavior.

Current mobile user flow:

- User opens the app.
- Home screen loads songs, artists, featured songs, and featured artists.
- User can browse songs.
- User can browse artists.
- User can search songs.
- User can open an artist profile.
- User can play songs from song cards.
- User can open the full player.
- User can like songs and follow artists.

Current player system:

- `mobile/src/context/PlayerContext.js` manages playback state.
- It uses `expo-audio`.
- It tracks current song, queue, current time, duration, play/pause state, repeat, and shuffle.
- `mobile/src/screens/PlayerScreen.js` can load a song from `route.params.id`.
- If a deep link opens `song/:id`, the player fetches songs, finds the matching song, and starts playback.

Current artist deep link behavior:

- `mobile/src/screens/ArtistDetailScreen.js` reads `route.params.id`.
- It fetches the artist by ID.
- It shows artist information and songs from that artist.

## Current TesoHub Connection

The TesoHub website connection is already started through the backend hub endpoint:

```text
/api/hub/search-documents/
```

This allows the main TesoHub website to discover TesoHub Music songs and artists without needing users to log in.

The backend returns TesoHub-ready search documents with:

- Public preview URL, such as `/preview/music_song_1`.
- App deep link, such as `tesohubmusic://song/1`.
- Category and type metadata.
- Tags for search.
- Image URL where available.

The mobile app is already prepared to receive:

- `tesohubmusic://song/:id`
- `tesohubmusic://artist/:id`
- Expo Go links using the Expo development prefix.

The intended website behavior is:

- Users search and preview music publicly on the TesoHub website.
- Deep actions like listening and following happen in TesoHub Music.
- During Expo development, website links should convert to `exp://LOCAL_IP:8081/--/song/:id`.
- Later APK builds should use `tesohubmusic://song/:id` and `tesohubmusic://artist/:id`.

## Problems / Gaps

- Real song upload exists in the admin backend, but it still needs stronger validation, clearer upload errors, file type checks, file size limits, and production storage planning.
- Artist management is admin-curated only. Artists cannot yet create accounts, claim profiles, upload songs, or manage their own profiles.
- Song records do not yet have a clear publish status such as draft, published, hidden, or rejected.
- Song district currently depends mostly on artist location. For launch, the data model should clearly support location or district for discoverability.
- Audio files are stored locally. This is fine for local development, but public launch needs a safer hosting/storage plan.
- Cover images are stored locally or by URL, but the backend should validate images and provide default fallbacks.
- The mobile player can play songs, but playback errors are mostly hidden from users.
- The mobile player does not currently update backend play counts when a song is played.
- The mobile search screen focuses on songs and does not yet search artists as a first-class result type.
- The backend search is useful, but ranking, typo tolerance, and stronger filtering are still basic.
- Deep linking is configured, but it still needs full end-to-end testing from the TesoHub website into Expo Go and later into an APK.
- The admin dashboard exists, but it is not yet a polished content management system.
- The backend uses default local admin credentials unless environment variables are configured. This must be fixed before any public deployment.
- The JSON file database is not suitable for larger concurrent usage without migration to a real database or careful deployment constraints.
- Existing seed/fallback content should be treated as demo or fallback data only, not real traction.
- The system does not yet have moderation, audit history, user roles, backups, analytics, or reporting.

## Serious MVP Requirements

For the first serious TesoHub Music launch, the following must work reliably:

1. Admin can add artists.
2. Admin can upload songs.
3. Songs have title, artist, genre, cover image, audio file, district, and status.
4. Mobile app can list songs from the backend.
5. Mobile app can list artists from the backend.
6. User can play songs.
7. Song play count increases when a song is played.
8. Artist profile shows artist details and songs.
9. Main TesoHub website can discover songs and artists through `/api/hub/search-documents/`.
10. Open in App works for Expo development and later APK deep links.

Before showing real artists or supporters, the MVP should also have:

- Secure admin credentials through environment variables.
- Clear demo/fallback data labeling.
- Basic upload validation for audio and images.
- A simple publish/hidden status for artists and songs.
- Reliable image and audio URLs on phone and web.
- Clear setup instructions for backend, Expo app, and TesoHub website.

## Recommended Build Order

1. Stabilize the backend data model.

   Add or confirm required fields for real launch: song status, artist status, district/location, audio file, cover image, genre, and created date.

2. Harden admin song and artist management.

   Improve validation, upload errors, file type checks, file size limits, and required fields. Make sure admin credentials come from environment variables before any public demo outside local development.

3. Add play count tracking.

   Add a backend endpoint such as `POST /api/songs/:id/play/`, then call it from the mobile player when a song starts playing.

4. Improve mobile playback reliability.

   Add visible loading and error states in the player. Keep normal playback working when no deep link is used.

5. Improve mobile search.

   Search both songs and artists. Keep the simple user flow, but make results feel useful for real content discovery.

6. Confirm artist profile completeness.

   Make sure artist profiles show photo, name, category, district/location, bio, songs, follow count, and an obvious play path.

7. Confirm TesoHub website discovery.

   Ensure `/api/hub/search-documents/` only exposes active or published music records once status exists. Confirm preview pages and Open in App work with real backend data.

8. Test Expo Go deep links end to end.

   Start the backend, start Expo, copy the Expo Go base URL, configure the website, search music on the website, and open a song/artist in the app.

9. Prepare real pilot content.

   Add a small set of real approved artists and songs through the admin system. Keep demo content separate and clearly labeled.

10. Plan deployment.

   Decide where the backend, storage, database, and website will run. Add backups, HTTPS, CORS rules, and production APK deep link testing.

## Next Exact Task

The next build task should be:

Add a real play-count tracking endpoint to `backend-js/server.js`, then update the mobile player so playing a song increments `play_count` once per song play session.

This is a good next step because it turns listening into measurable real product activity without changing the existing app flow.
