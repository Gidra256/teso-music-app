import { API_BASE_URL } from "../config/api";
import { fallbackArtists, fallbackSongs } from "../data/fallbackData";

async function fetchJson(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json();
}

async function postDeviceAction(path, deviceId) {
  return fetchJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId }),
  });
}

export async function getArtists() {
  try {
    return await fetchJson("/artists/");
  } catch (error) {
    return fallbackArtists;
  }
}

export async function getArtist(id) {
  try {
    return await fetchJson(`/artists/${id}/`);
  } catch (error) {
    const artist = fallbackArtists.find((item) => item.id === Number(id));
    return {
      ...artist,
      songs: fallbackSongs.filter((song) => song.artist === Number(id)),
    };
  }
}

export async function getSongs() {
  try {
    return await fetchJson("/songs/");
  } catch (error) {
    return fallbackSongs;
  }
}

export async function getFeaturedArtists() {
  try {
    return await fetchJson("/featured-artists/");
  } catch (error) {
    return fallbackArtists.filter((artist) => artist.is_featured);
  }
}

export async function getFeaturedSongs() {
  try {
    return await fetchJson("/featured-songs/");
  } catch (error) {
    return fallbackSongs.filter((song) => song.is_featured);
  }
}

export async function likeSong(id, deviceId) {
  return postDeviceAction(`/songs/${id}/like/`, deviceId);
}

export async function unlikeSong(id, deviceId) {
  return postDeviceAction(`/songs/${id}/unlike/`, deviceId);
}

export async function followArtist(id, deviceId) {
  return postDeviceAction(`/artists/${id}/follow/`, deviceId);
}

export async function unfollowArtist(id, deviceId) {
  return postDeviceAction(`/artists/${id}/unfollow/`, deviceId);
}
