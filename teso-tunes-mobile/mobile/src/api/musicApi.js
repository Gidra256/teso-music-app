import AsyncStorage from "@react-native-async-storage/async-storage";

import { API_BASE_URL } from "../config/api";

export const BACKEND_CONNECTION_ERROR =
  "Could not connect to TesoHub Music backend.";

let authToken = "";

const CACHE_KEYS = {
  artists: "tesohub_music_cache_artists",
  artist: (id) => `tesohub_music_cache_artist_${id}`,
  featuredArtists: "tesohub_music_cache_featured_artists",
  featuredSongs: "tesohub_music_cache_featured_songs",
  songs: "tesohub_music_cache_songs",
};

export function setAuthToken(token = "") {
  authToken = token;
}

function countItems(data) {
  if (Array.isArray(data)) return data.length;
  if (data?.songs && Array.isArray(data.songs)) return data.songs.length;
  return data ? 1 : 0;
}

function backendError(path, error) {
  const wrappedError = new Error(BACKEND_CONNECTION_ERROR);
  wrappedError.path = path;
  wrappedError.cause = error;
  return wrappedError;
}

async function fetchJson(path, options) {
  const url = `${API_BASE_URL}${path}`;
  console.log(`[TesoHub Music API] Fetching: ${url}`);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options?.headers || {}),
      },
    });
  } catch (error) {
    console.warn(`[TesoHub Music API] Network error for ${url}:`, error?.message || error);
    throw backendError(path, error);
  }

  console.log(`[TesoHub Music API] ${url} status: ${response.status}`);

  const data = await response.json();

  if (!response.ok) {
    const error = backendError(
      path,
      new Error(data?.detail || `API request failed: ${response.status}`)
    );
    error.detail = data?.detail;
    throw error;
  }

  console.log(`[TesoHub Music API] ${path} returned ${countItems(data)} item(s).`);
  return data;
}

async function readCachedRealData(cacheKey) {
  try {
    const cachedValue = await AsyncStorage.getItem(cacheKey);
    if (!cachedValue) return null;

    const cached = JSON.parse(cachedValue);
    if (cached?.source !== "backend" || !Object.prototype.hasOwnProperty.call(cached, "data")) {
      return null;
    }

    return cached.data;
  } catch (error) {
    return null;
  }
}

async function writeCachedRealData(cacheKey, data) {
  try {
    await AsyncStorage.setItem(
      cacheKey,
      JSON.stringify({
        cached_at: new Date().toISOString(),
        data,
        source: "backend",
      })
    );
  } catch (error) {}
}

async function fetchJsonWithRealCache(path, cacheKey, label) {
  try {
    const data = await fetchJson(path);
    await writeCachedRealData(cacheKey, data);
    return data;
  } catch (error) {
    const cachedData = await readCachedRealData(cacheKey);
    if (cachedData !== null) {
      console.warn(
        `[TesoHub Music API] ${label} failed; using cached backend data.`,
        error?.message || error
      );
      return cachedData;
    }

    console.warn(
      `[TesoHub Music API] ${label} failed and no real cached data exists.`,
      error?.message || error
    );
    throw error;
  }
}

async function cachedArtistFromLists(id) {
  const numericId = Number(id);
  const [cachedArtists, cachedSongs] = await Promise.all([
    readCachedRealData(CACHE_KEYS.artists),
    readCachedRealData(CACHE_KEYS.songs),
  ]);

  const artist = Array.isArray(cachedArtists)
    ? cachedArtists.find((item) => Number(item.id) === numericId)
    : null;

  if (!artist) return null;

  const songs = Array.isArray(cachedSongs)
    ? cachedSongs.filter((song) => Number(song.artist) === numericId)
    : [];

  return { ...artist, songs };
}

async function postDeviceAction(path, deviceId) {
  return fetchJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId }),
  });
}

export async function registerListenerAccount(payload) {
  return fetchJson("/auth/register/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loginListenerAccount(payload) {
  return fetchJson("/auth/login/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getListenerAccount() {
  return fetchJson("/auth/me/");
}

export async function updateListenerAccount(payload) {
  return fetchJson("/auth/me/", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function logoutListenerAccount() {
  return fetchJson("/auth/logout/", {
    method: "POST",
  });
}

export async function getMyArtistApplication() {
  return fetchJson("/artist-applications/me/");
}

export async function submitArtistApplication(formData) {
  return fetchJson("/artist-applications/", {
    method: "POST",
    body: formData,
  });
}

export async function getArtistStudioDashboard() {
  return fetchJson("/artist-studio/dashboard/");
}

export async function getArtistStudioReleases(status = "") {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return fetchJson(`/artist-studio/releases/${query}`);
}

export async function createArtistStudioRelease(formData) {
  return fetchJson("/artist-studio/releases/", {
    method: "POST",
    body: formData,
  });
}

export async function updateArtistStudioRelease(id, formData) {
  return fetchJson(`/artist-studio/releases/${id}/`, {
    method: "PUT",
    body: formData,
  });
}

export async function submitArtistStudioRelease(id) {
  return fetchJson(`/artist-studio/releases/${id}/submit/`, {
    method: "POST",
  });
}

export async function updateArtistStudioProfile(formData) {
  return fetchJson("/artist-studio/profile/", {
    method: "PUT",
    body: formData,
  });
}

export async function getArtists() {
  return fetchJsonWithRealCache("/artists/", CACHE_KEYS.artists, "artists");
}

export async function getArtist(id) {
  try {
    const artist = await fetchJson(`/artists/${id}/`);
    await writeCachedRealData(CACHE_KEYS.artist(id), artist);
    return artist;
  } catch (error) {
    const cachedArtist =
      (await readCachedRealData(CACHE_KEYS.artist(id))) ||
      (await cachedArtistFromLists(id));

    if (cachedArtist) {
      console.warn(
        `[TesoHub Music API] artist ${id} failed; using cached backend data.`,
        error?.message || error
      );
      return cachedArtist;
    }

    console.warn(
      `[TesoHub Music API] artist ${id} failed and no real cached data exists.`,
      error?.message || error
    );
    throw error;
  }
}

export async function getSongs() {
  return fetchJsonWithRealCache("/songs/", CACHE_KEYS.songs, "songs");
}

export async function getFeaturedArtists() {
  return fetchJsonWithRealCache(
    "/featured-artists/",
    CACHE_KEYS.featuredArtists,
    "featured artists"
  );
}

export async function getFeaturedSongs() {
  return fetchJsonWithRealCache(
    "/featured-songs/",
    CACHE_KEYS.featuredSongs,
    "featured songs"
  );
}

export async function likeSong(id, deviceId) {
  return postDeviceAction(`/songs/${id}/like/`, deviceId);
}

export async function unlikeSong(id, deviceId) {
  return postDeviceAction(`/songs/${id}/unlike/`, deviceId);
}

export async function incrementSongPlay(songId) {
  if (!songId) return null;

  try {
    return await fetchJson(`/songs/${songId}/play/`, {
      method: "POST",
    });
  } catch (error) {
    console.log("Could not increment song play count:", error?.message || error);
    return null;
  }
}

export async function followArtist(id, deviceId) {
  return postDeviceAction(`/artists/${id}/follow/`, deviceId);
}

export async function unfollowArtist(id, deviceId) {
  return postDeviceAction(`/artists/${id}/unfollow/`, deviceId);
}
