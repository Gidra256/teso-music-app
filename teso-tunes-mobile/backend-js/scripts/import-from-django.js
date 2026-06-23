import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const DJANGO_API = process.env.DJANGO_API || "http://127.0.0.1:8000/api";

function localMediaPath(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.pathname.startsWith("/media/")) return url.pathname;
    if (url.pathname.startsWith("/uploads/")) return url.pathname;
  } catch (error) {
    if (value.startsWith("/media/") || value.startsWith("/uploads/")) return value;
  }
  return value;
}

async function fetchJson(pathname) {
  const response = await fetch(`${DJANGO_API}${pathname}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${pathname}: ${response.status}`);
  }
  return response.json();
}

const [artistsFromApi, songsFromApi] = await Promise.all([
  fetchJson("/artists/"),
  fetchJson("/songs/"),
]);

const artists = artistsFromApi.map((artist) => ({
  id: Number(artist.id),
  name: artist.name || "",
  category: artist.category || "",
  bio: artist.bio || "",
  photo: localMediaPath(artist.photo),
  location: artist.location || "",
  is_featured: Boolean(artist.is_featured),
  created_at: artist.created_at || new Date().toISOString(),
}));

const songs = songsFromApi.map((song) => ({
  id: Number(song.id),
  artist: Number(song.artist),
  title: song.title || "",
  audio_file: localMediaPath(song.audio_file),
  cover_image: localMediaPath(song.cover_image),
  genre: song.genre || "",
  lyrics: song.lyrics || "",
  play_count: Number(song.play_count || 0),
  release_date: song.release_date || "",
  is_featured: Boolean(song.is_featured),
  created_at: song.created_at || new Date().toISOString(),
}));

const songLikes = songsFromApi.flatMap((song) =>
  Array.from({ length: Number(song.like_count || 0) }, (_, index) => ({
    song: Number(song.id),
    device_id: `imported-like-${song.id}-${index + 1}`,
    created_at: new Date().toISOString(),
  }))
);

const artistFollows = artistsFromApi.flatMap((artist) =>
  Array.from({ length: Number(artist.follower_count || 0) }, (_, index) => ({
    artist: Number(artist.id),
    device_id: `imported-follow-${artist.id}-${index + 1}`,
    created_at: new Date().toISOString(),
  }))
);

const db = {
  artists,
  songs,
  songLikes,
  artistFollows,
  nextIds: {
    artist: Math.max(0, ...artists.map((artist) => artist.id)) + 1,
    song: Math.max(0, ...songs.map((song) => song.id)) + 1,
  },
};

await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);

console.log(
  `Imported ${artists.length} artists, ${songs.length} songs, ${songLikes.length} likes, and ${artistFollows.length} follows from ${DJANGO_API}`
);
