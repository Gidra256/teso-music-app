import {
  getAndroidStoreUrl,
  getIosStoreUrl,
  getShareBaseUrl,
} from "../../shareConfig";

// Use a public backend URL for APK builds. Override this env var for local testing.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_MUSIC_API_BASE_URL ||
  "https://teso-music-app.onrender.com/api";

export const SHARE_BASE_URL = getShareBaseUrl();

export const ANDROID_STORE_URL = getAndroidStoreUrl();

export const IOS_STORE_URL = getIosStoreUrl();
