import {
  getAndroidStoreUrl,
  getIosStoreUrl,
  getShareBaseUrl,
} from "../../shareConfig";

// Use a public backend URL for APK builds. Override this env var for local testing.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_MUSIC_API_BASE_URL ||
  "https://teso-music-app.onrender.com/api";

export const SHARE_BASE_URL = (process.env.EXPO_PUBLIC_SHARE_BASE_URL || getShareBaseUrl()).replace(/\/+$/, "");

export const MUSIC_WEB_BASE_URL = (
  process.env.EXPO_PUBLIC_MUSIC_WEB_URL || "https://tesohub-music-pwa.onrender.com"
).replace(/\/+$/, "");

export const ANDROID_STORE_URL = getAndroidStoreUrl();

// Public distribution destination; an environment override can later point to Google Play.
export const ANDROID_DOWNLOAD_URL =
  process.env.EXPO_PUBLIC_ANDROID_DOWNLOAD_URL ||
  process.env.EXPO_PUBLIC_ANDROID_STORE_URL ||
  ANDROID_STORE_URL ||
  "https://github.com/Gidra256/teso-music-app/releases/download/tesohub-music-android-v1.0.6/TesoHub-Music-Android-v1.0.6.apk";

export const IOS_STORE_URL = getIosStoreUrl();
