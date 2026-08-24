// Use a public backend URL for APK builds. Override this env var for local testing.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_MUSIC_API_BASE_URL ||
  "https://teso-music-app.onrender.com/api";

// Keep fallback off for the serious MVP. Turn this on only when intentionally
// demoing the app without a backend.
export const USE_FALLBACK_DATA = false;
