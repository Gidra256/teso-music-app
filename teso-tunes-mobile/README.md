# Teso Tunes

Teso Tunes is the digital home of Teso music, focused on artists from the Teso region of Uganda.

Version 1 is admin-curated only. Artists do not create accounts, upload songs, or manage profiles. The admin manages artists, songs, covers, featured songs, and featured artists through the JavaScript admin dashboard.

## Project Structure

```text
teso-tunes-mobile/
  backend/       # legacy Django backend, kept for reference/imports
  backend-js/    # current JavaScript API and React admin
  mobile/
  README.md
```

## JavaScript Backend and Admin

Open PowerShell in the project folder:

```powershell
npm run backend:install
npm run backend
```

Admin URL:

```text
http://127.0.0.1:8000/admin/
```

API URLs:

```text
http://127.0.0.1:8000/api/artists/
http://127.0.0.1:8000/api/songs/
http://127.0.0.1:8000/api/featured-artists/
http://127.0.0.1:8000/api/featured-songs/
http://127.0.0.1:8000/api/hub/search-documents/
```

Default local admin login:

```text
Username: admin
Password: TesoAdmin@2026
```

To import existing data from the legacy Django backend, first run Django on port 8000, then run:

```powershell
npm run backend:import-django
```

## Mobile Setup on Windows 11

Open another PowerShell window:

```powershell
cd mobile
npm install
npx expo start
```

If you are in the project root folder, `teso-tunes-mobile`, you can also run:

```powershell
npm run mobile:install
npm run start
```

The API base URL lives in:

```text
mobile/src/config/api.js
```

For Android phone testing, change it from `http://127.0.0.1:8000/api` to your laptop IPv4 address, for example:

```javascript
export const API_BASE_URL = "http://192.168.1.15:8000/api";
```

## Test on Android with Expo Go

1. Install Expo Go on your Android phone.
2. Connect your phone and laptop to the same Wi-Fi.
3. Run `npx expo start` inside the `mobile` folder.
4. Scan the QR code with Expo Go.
5. Make sure the JavaScript backend is running with `npm run backend`.

## Public Backend for APK Testing

An APK can open without Expo Go and without your laptop, but it still needs a
public API URL to fetch songs, artists, images, and uploaded audio files.

The current JavaScript backend is ready for public hosting. It supports:

- `PORT` from the hosting provider.
- `PUBLIC_BASE_URL` for HTTPS upload URLs, for example
  `https://teso-tunes-api.onrender.com`.
- `STORAGE_DIR` for persistent data and uploads, for example `/var/data`.
- `/healthz` for host health checks.

A Render Blueprint is included at the Git repo root:

```text
../render.yaml
```

The Blueprint uses a persistent disk because the admin dashboard can upload
song files and cover images. If you deploy without persistent storage, uploads
and JSON data can disappear after redeploys or restarts.

After deployment, use the public backend URL in the mobile build:

```powershell
cd "C:\Users\HP\Documents\teso music app\teso-tunes-mobile\mobile"
$env:EXPO_PUBLIC_MUSIC_API_BASE_URL="https://YOUR-BACKEND-URL/api"
npx expo start --clear
```

For APK builds, set the same environment variable before running EAS:

```powershell
$env:EXPO_PUBLIC_MUSIC_API_BASE_URL="https://YOUR-BACKEND-URL/api"
npx eas build -p android --profile preview
```

The `preview` EAS profile builds an installable Android APK.

## Test TesoHub Website to Music App Links

Use this loop while building:

1. Start the music backend:

```powershell
cd "C:\Users\HP\Documents\teso music app\teso-tunes-mobile"
npm run backend
```

2. Start the Expo app:

```powershell
cd "C:\Users\HP\Documents\teso music app\teso-tunes-mobile\mobile"
npx expo start
```

3. Copy the line printed in the Expo terminal:

```text
Expo Go deep link base: exp://YOUR_LOCAL_IP:8081/--/
```

4. In the TesoHub website folder, create or update `.env.local`:

```env
MUSIC_API_BASE_URL=http://YOUR_LOCAL_IP:8000
NEXT_PUBLIC_EXPO_GO_BASE_URL=exp://YOUR_LOCAL_IP:8081/--/
```

Use your laptop IPv4 address for phone testing. Keep `localhost` only when testing everything in a desktop browser.

5. Start the TesoHub website:

```powershell
cd "C:\Users\HP\Desktop\TesoHub_Runnable_Prototype_With_Logo\TesoHub_real"
npm run dev
```

6. Open the TesoHub website on the same phone that has Expo Go open.
7. Search for music, for example `Sparo`, `Akogo`, or `Teso`.
8. Tap `Open in App`.
9. The button should show an `exp://.../--/song/1` or `exp://.../--/artist/1` target, then Expo Go should open the matching player or artist screen.

Production APK links will use the custom scheme directly:

```text
tesohubmusic://song/1
tesohubmusic://artist/1
```

## Troubleshooting

If the API does not load on your phone:

- Use the laptop IPv4 address, not `localhost` or `127.0.0.1`.
- Check Windows Firewall and allow Node.js on private networks.
- Confirm the phone and laptop are on the same Wi-Fi.
- Confirm the backend is running with `0.0.0.0:8000`.
- The app includes fallback local data, so the interface still displays music if the backend is offline.

## Admin-Curated Content

Use the JavaScript admin dashboard to:

- Add, edit, and delete artists.
- Add, edit, and delete songs.
- Mark artists as featured.
- Mark songs as featured.

There is no public upload flow, artist login, or artist profile management in version 1.
