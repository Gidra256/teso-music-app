const DEFAULT_SHARE_BASE_URL = "https://teso-music-app.onrender.com";

function cleanUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getShareBaseUrl(env = process.env) {
  return cleanUrl(env.EXPO_PUBLIC_SHARE_BASE_URL || DEFAULT_SHARE_BASE_URL);
}

function getAndroidStoreUrl(env = process.env) {
  return env.EXPO_PUBLIC_ANDROID_STORE_URL || "";
}

function getIosStoreUrl(env = process.env) {
  return env.EXPO_PUBLIC_IOS_STORE_URL || "";
}

function getShareHost(env = process.env) {
  try {
    const parsed = new URL(getShareBaseUrl(env));
    return parsed.protocol === "https:" ? parsed.hostname : "";
  } catch (error) {
    return "";
  }
}

module.exports = {
  DEFAULT_SHARE_BASE_URL,
  getAndroidStoreUrl,
  getIosStoreUrl,
  getShareBaseUrl,
  getShareHost,
};
