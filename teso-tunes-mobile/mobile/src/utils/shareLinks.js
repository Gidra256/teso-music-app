import { Share } from "react-native";

import { SHARE_BASE_URL } from "../config/api";

export function songShareUrl(songOrId) {
  const id = typeof songOrId === "object" ? songOrId?.id : songOrId;
  return `${SHARE_BASE_URL}/song/${encodeURIComponent(String(id || ""))}`;
}

export function artistShareUrl(artistOrId) {
  const id = typeof artistOrId === "object" ? artistOrId?.id : artistOrId;
  return `${SHARE_BASE_URL}/artist/${encodeURIComponent(String(id || ""))}`;
}

export function playlistShareUrl(playlistOrId) {
  const id = typeof playlistOrId === "object" ? playlistOrId?.id : playlistOrId;
  return `${SHARE_BASE_URL}/playlist/${encodeURIComponent(String(id || ""))}`;
}

export function songShareMessage(song) {
  const title = song?.title || "TesoHub Music";
  const artistName = song?.artist_name || "TesoHub Music";
  const url = songShareUrl(song);

  return {
    title,
    url,
    message: `${title} - ${artistName}\nListen on TesoHub Music\n${url}`,
  };
}

export function trackShareEvent(name, payload = {}) {
  console.log("[TesoHub Music Share]", { name, ...payload });
}

export async function shareSongLink(song) {
  if (!song?.id) return;

  const shareContent = songShareMessage(song);
  trackShareEvent("song_share", { song_id: song.id });

  await Share.share({
    message: shareContent.message,
    title: shareContent.title,
    url: shareContent.url,
  });
}

export async function shareArtistLink(artist) {
  if (!artist?.id) return;

  const url = artistShareUrl(artist);
  const title = artist.name || "TesoHub Music artist";
  trackShareEvent("artist_share", { artist_id: artist.id });

  await Share.share({
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

  await Share.share({
    message: `${title}\nListen on TesoHub Music\n${url}`,
    title,
    url,
  });
}
