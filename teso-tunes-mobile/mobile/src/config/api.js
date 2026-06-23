// Use your laptop IPv4 address when testing on a phone.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_MUSIC_API_BASE_URL || "http://192.168.1.9:8000/api";

// Keep fallback off for the serious MVP. Turn this on only when intentionally
// demoing the app without a backend.
export const USE_FALLBACK_DATA = false;
