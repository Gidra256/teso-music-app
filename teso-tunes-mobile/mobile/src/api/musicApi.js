import { API_BASE_URL, USE_FALLBACK_DATA } from "../config/api";
import { fallbackArtists, fallbackSongs } from "../data/fallbackData";

export const BACKEND_CONNECTION_ERROR =
  "Could not connect to TesoHub Music backend.";

let authToken = "";

export function setAuthToken(token = "") {
  authToken = token;
}

function countItems(data) {
  if (Array.isArray(data)) return data.length;
  if (data?.songs && Array.isArray(data.songs)) return data.songs.length;
  return data ? 1 : 0;
}

function warnFallback(label, error) {
  console.warn(
    `[TesoHub Music API] Using fallback ${label}.`,
    error?.message || error
  );
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

function fallbackOrThrow(label, data, error) {
  if (USE_FALLBACK_DATA) {
    warnFallback(label, error);
    return data;
  }

  console.warn(
    `[TesoHub Music API] ${label} failed and fallback is disabled.`,
    error?.message || error
  );
  throw error;
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

export async function getArtists() {
  try {
    return await fetchJson("/artists/");
  } catch (error) {
    return fallbackOrThrow("artists", fallbackArtists, error);
  }
}

export async function getArtist(id) {
  try {
    return await fetchJson(`/artists/${id}/`);
  } catch (error) {
    const artist = fallbackArtists.find((item) => item.id === Number(id));
    const fallbackArtist = artist
      ? {
          ...artist,
          songs: fallbackSongs.filter((song) => song.artist === Number(id)),
        }
      : null;

    return fallbackOrThrow(`artist ${id}`, fallbackArtist, error);
  }
}

export async function getSongs() {
  try {
    return await fetchJson("/songs/");
  } catch (error) {
    return fallbackOrThrow("songs", fallbackSongs, error);
  }
}

export async function getFeaturedArtists() {
  try {
    return await fetchJson("/featured-artists/");
  } catch (error) {
    return fallbackOrThrow(
      "featured artists",
      fallbackArtists.filter((artist) => artist.is_featured),
      error
    );
  }
}

export async function getFeaturedSongs() {
  try {
    return await fetchJson("/featured-songs/");
  } catch (error) {
    return fallbackOrThrow(
      "featured songs",
      fallbackSongs.filter((song) => song.is_featured),
      error
    );
  }
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
