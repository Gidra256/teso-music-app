import { Platform, Share } from "react-native";

import { MUSIC_WEB_BASE_URL, SHARE_BASE_URL } from "../config/api";

export function songShareUrl(songOrId) {
  const id = typeof songOrId === "object" ? songOrId?.id : songOrId;
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) {
    throw new Error("This song is unavailable.");
  }
  return `${SHARE_BASE_URL}/song/${encodeURIComponent(String(id))}`;
}

export function artistShareUrl(artistOrId) {
  const id = typeof artistOrId === "object" ? artistOrId?.id : artistOrId;
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) throw new Error("This artist is unavailable.");
  return `${MUSIC_WEB_BASE_URL}/artist/${id}`;
}

export function playlistShareUrl(playlistOrId) {
  const id = typeof playlistOrId === "object" ? playlistOrId?.id : playlistOrId;
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) throw new Error("This playlist is unavailable.");
  return `${MUSIC_WEB_BASE_URL}/playlist/${id}`;
}

export function songShareMessage(song) {
  if (song?.status !== "published") throw new Error("Only published songs can be shared.");
  const title = song?.title || "TesoHub Music";
  const artistName = song?.artist_name || "TesoHub Music";
  const url = songShareUrl(song);

  return {
    title,
    url,
    text: `Listen to ${title} by ${artistName} on TesoHub Music`,
    message: `Listen to ${title} by ${artistName} on TesoHub Music\n${url}`,
  };
}

export function trackShareEvent(name, payload = {}) {
  console.log("[TesoHub Music Share]", { name, ...payload, timestamp: new Date().toISOString() });
}

export async function copySongLink(song) {
  const { url } = songShareMessage(song);
  if (Platform.OS !== "web") throw new Error("Use the share sheet to copy this link.");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
  } else if (typeof document !== "undefined") {
    const input = document.createElement("textarea");
    input.value = url;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    try {
      input.select();
      if (!document.execCommand("copy")) throw new Error("Copy failed. Select the link to copy it.");
    } finally {
      input.remove();
    }
  } else {
    throw new Error("Copy is not available here.");
  }
  trackShareEvent("song_shared", { song_id: song.id, platform: Platform.OS, method: "copy_link" });
  return { method: "copy_link" };
}

export async function shareSongLink(song) {
  const shareContent = songShareMessage(song);
  if (Platform.OS === "web") {
    const data = { title: shareContent.title, text: shareContent.text, url: shareContent.url };
    if (typeof navigator === "undefined" || !navigator.share ||
        (navigator.canShare && !navigator.canShare(data))) return copySongLink(song);
    try {
      await navigator.share(data);
    } catch (error) {
      if (error?.name === "AbortError") return { dismissed: true };
      throw error;
    }
    trackShareEvent("song_shared", { song_id: song.id, platform: "web", method: "web_share" });
    return { method: "web_share" };
  }
  const result = await Share.share({
    message: Platform.OS === "ios" ? shareContent.text : shareContent.message,
    title: shareContent.title,
    ...(Platform.OS === "ios" ? { url: shareContent.url } : {}),
  });
  if (result.action !== Share.sharedAction) return { dismissed: true };
  trackShareEvent("song_shared", { song_id: song.id, platform: Platform.OS, method: "native_share" });
  return { method: "native_share" };
}

export async function shareArtistLink(artist) {
  if (!artist?.id) return;

  const url = artistShareUrl(artist);
  const title = artist.name || "TesoHub Music artist";
  trackShareEvent("artist_share", { artist_id: artist.id });

  return shareContentLink({
    message: `${title}\nListen on TesoHub Music\n${url}`,
    title,
    url,
  });
}

export async function sharePlaylistLink(playlist) {
  if (!playlist?.id) return;

  const url = playlistShareUrl(playlist);
  const title = playlist.name || "TesoHub Music playlist";
  trackShareEvent("playlist_share", { playlist_id: playlist.id });

  return shareContentLink({
    message: `${title}\nListen on TesoHub Music\n${url}`,
    title,
    url,
  });
}

async function shareContentLink(content) {
  if (Platform.OS !== "web") return Share.share(content);
  const data = { title: content.title, text: content.title, url: content.url };
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try { await navigator.share(data); return { method: "web_share" }; }
    catch (error) { if (error.name === "AbortError") return { dismissed: true }; throw error; }
  }
  if (!navigator.clipboard?.writeText) throw new Error("Sharing is unavailable in this browser. Copy the page address instead.");
  await navigator.clipboard.writeText(content.url);
  return { method: "copy_link" };
}
