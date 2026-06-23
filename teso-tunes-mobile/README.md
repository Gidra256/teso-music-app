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
