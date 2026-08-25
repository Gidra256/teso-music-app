import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : __dirname;
const DATA_DIR = path.join(STORAGE_DIR, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const LEGACY_MEDIA_DIR = path.join(__dirname, "..", "backend", "media");
const PORT = Number(process.env.PORT || 8000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "TesoAdmin@2026";
const ADMIN_TOKEN =
  process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString("hex");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const PUBLIC_SHARE_BASE_URL = (
  process.env.PUBLIC_SHARE_BASE_URL ||
  process.env.EXPO_PUBLIC_SHARE_BASE_URL ||
  PUBLIC_BASE_URL ||
  ""
).replace(/\/+$/, "");
const ANDROID_PACKAGE_NAME =
  process.env.ANDROID_PACKAGE_NAME || "com.tesotunes.app";
const ANDROID_SHA256_CERT_FINGERPRINTS = String(
  process.env.ANDROID_SHA256_CERT_FINGERPRINTS || "",
)
  .split(",")
  .map((fingerprint) => fingerprint.trim())
  .filter(Boolean);
const ANDROID_STORE_URL =
  process.env.ANDROID_STORE_URL ||
  process.env.EXPO_PUBLIC_ANDROID_STORE_URL ||
  "";
const IOS_BUNDLE_IDENTIFIER =
  process.env.IOS_BUNDLE_IDENTIFIER ||
  process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER ||
  "";
const IOS_STORE_URL =
  process.env.IOS_STORE_URL || process.env.EXPO_PUBLIC_IOS_STORE_URL || "";
const IOS_TEAM_ID = process.env.IOS_TEAM_ID || "";

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/media", express.static(LEGACY_MEDIA_DIR));
app.use("/app-assets", express.static(path.join(__dirname, "..", "mobile", "assets")));
app.use("/admin", express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", service: "teso-tunes-api" });
});

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
]);
const IMAGE_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const LISTENER_ROLES = new Set(["listener", "artist_pending", "artist"]);
const RELEASE_STATUSES = new Set([
  "draft",
  "under_review",
  "approved",
  "rejected",
  "scheduled",
  "published",
]);
const GENRE_OPTIONS = [
  "Ateso Traditional",
  "Teso Gospel",
  "Gospel",
  "Afrobeats",
  "Amapiano",
  "Dancehall",
  "Reggae",
  "Hip hop / Rap",
  "R&B",
  "Kadongo Kamu",
  "Cultural / Folk",
  "Instrumental",
  "Other",
  "Not sure",
];

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const folder = uploadFolderFor(file.fieldname);
      await fs.mkdir(folder, { recursive: true });
      cb(null, folder);
    },
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname || "");
      const safeName = path
        .basename(file.originalname || "upload", extension)
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      cb(null, `${Date.now()}-${safeName || "upload"}${extension}`);
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 4,
  },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const mime = String(file.mimetype || "").toLowerCase();

    if (file.fieldname === "audio_upload") {
      if (AUDIO_EXTENSIONS.has(extension) || mime.startsWith("audio/")) {
        return cb(null, true);
      }
      return cb(new Error("Upload a valid audio file."));
    }

    if (file.fieldname === "photo_file" || file.fieldname === "cover_upload") {
      if (IMAGE_EXTENSIONS.has(extension) || mime.startsWith("image/")) {
        return cb(null, true);
      }
      return cb(new Error("Upload a valid image file."));
    }

    return cb(new Error("Unsupported upload field."));
  },
});

function uploadFolderFor(fieldname) {
  if (fieldname === "photo_file")
    return path.join(UPLOADS_DIR, "artists", "photos");
  if (fieldname === "audio_upload")
    return path.join(UPLOADS_DIR, "songs", "audio");
  if (fieldname === "cover_upload")
    return path.join(UPLOADS_DIR, "songs", "covers");
  return UPLOADS_DIR;
}

function uploadUrlFor(file) {
  if (!file) return "";
  const relative = path
    .relative(UPLOADS_DIR, file.path)
    .split(path.sep)
    .join("/");
  return `/uploads/${relative}`;
}

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch (error) {
    await saveDb(emptyDb());
  }
}

async function loadDb() {
  await ensureDb();
  const raw = await fs.readFile(DB_PATH, "utf8");
  return normalizeDb(JSON.parse(raw));
}

async function saveDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

function emptyDb() {
  return {
    artists: [],
    songs: [],
    listeners: [],
    authTokens: [],
    songLikes: [],
    artistFollows: [],
    playlists: [],
    playlistSongs: [],
    artistApplications: [],
    releases: [],
    nextIds: {
      artist: 1,
      artistApplication: 1,
      listener: 1,
      playlist: 1,
      release: 1,
      song: 1,
    },
  };
}

function normalizeDb(db) {
  db.artists = Array.isArray(db.artists) ? db.artists : [];
  db.songs = Array.isArray(db.songs) ? db.songs : [];
  db.listeners = Array.isArray(db.listeners) ? db.listeners : [];
  db.authTokens = Array.isArray(db.authTokens) ? db.authTokens : [];
  db.songLikes = Array.isArray(db.songLikes) ? db.songLikes : [];
  db.artistFollows = Array.isArray(db.artistFollows) ? db.artistFollows : [];
  db.playlists = Array.isArray(db.playlists) ? db.playlists : [];
  db.playlistSongs = Array.isArray(db.playlistSongs) ? db.playlistSongs : [];
  db.artistApplications = Array.isArray(db.artistApplications)
    ? db.artistApplications
    : [];
  db.releases = Array.isArray(db.releases) ? db.releases : [];
  db.listeners = db.listeners.map((listener) => ({
    ...listener,
    role: LISTENER_ROLES.has(listener.role) ? listener.role : "listener",
    artist_id: listener.artist_id ? Number(listener.artist_id) : null,
    artist_application_id: listener.artist_application_id
      ? Number(listener.artist_application_id)
      : null,
  }));
  db.authTokens = db.authTokens.map((session) => ({
    ...session,
    id:
      session.id ||
      crypto
        .createHash("sha256")
        .update(session.token_hash || `${session.listener}:${session.created_at}`)
        .digest("hex")
        .slice(0, 16),
    device_id: session.device_id || "",
    device_name: session.device_name || "",
    last_active_at: session.last_active_at || session.created_at || null,
  }));
  db.releases = db.releases.map((release) => ({
    ...release,
    status: RELEASE_STATUSES.has(release.status) ? release.status : "draft",
    artist: release.artist ? Number(release.artist) : null,
    listener: release.listener ? Number(release.listener) : null,
    public_song: release.public_song ? Number(release.public_song) : null,
  }));
  db.playlists = db.playlists.map((playlist) => ({
    ...playlist,
    owner: Number(playlist.owner),
  }));
  db.playlistSongs = db.playlistSongs.map((playlistSong) => ({
    ...playlistSong,
    playlist: Number(playlistSong.playlist),
    song: Number(playlistSong.song),
    position: Number(playlistSong.position || 0),
  }));
  db.nextIds = db.nextIds || {};
  db.nextIds.artist = Math.max(
    Number(db.nextIds.artist || 1),
    maxNextId(db.artists),
  );
  db.nextIds.song = Math.max(Number(db.nextIds.song || 1), maxNextId(db.songs));
  db.nextIds.listener = Math.max(
    Number(db.nextIds.listener || 1),
    maxNextId(db.listeners),
  );
  db.nextIds.artistApplication = Math.max(
    Number(db.nextIds.artistApplication || 1),
    maxNextId(db.artistApplications),
  );
  db.nextIds.release = Math.max(
    Number(db.nextIds.release || 1),
    maxNextId(db.releases),
  );
  db.nextIds.playlist = Math.max(
    Number(db.nextIds.playlist || 1),
    maxNextId(db.playlists),
  );
  return db;
}

function maxNextId(items) {
  return items.reduce((maxId, item) => Math.max(maxId, Number(item.id || 0)), 0) + 1;
}

function absoluteUrl(req, value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
}

function publicShareBaseUrl(req) {
  return PUBLIC_SHARE_BASE_URL || PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function canonicalSongShareUrl(req, songId) {
  return `${publicShareBaseUrl(req)}/song/${encodeURIComponent(String(songId))}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function trackProductEvent(eventName, payload = {}) {
  console.log("[TesoHub Music Event]", {
    event: eventName,
    ...payload,
    occurred_at: new Date().toISOString(),
  });
}

function storeButton(url, label) {
  if (!url) return "";
  return `<a class="button secondary" href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

function renderSongLandingPage(req, db, song) {
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(song.artist),
  );
  const title = song?.title || "TesoHub Music";
  const artistName = artist?.name || "TesoHub Music";
  const shareUrl = canonicalSongShareUrl(req, song.id);
  const artworkUrl =
    absoluteUrl(req, song.cover_image) ||
    absoluteUrl(req, "/app-assets/images/tesohub-music.png");
  const description = `Listen to ${title} by ${artistName} on TesoHub Music.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} - TesoHub Music</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:type" content="music.song">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(artworkUrl)}">
    <meta property="og:url" content="${escapeHtml(shareUrl)}">
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        align-items: center;
        background: #050506;
        color: #f8fafc;
        display: flex;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
        padding: 24px;
      }
      main {
        max-width: 430px;
        width: 100%;
      }
      .artwork {
        aspect-ratio: 1;
        background: #18181b;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        box-shadow: 0 26px 60px rgba(32, 230, 243, 0.16);
        object-fit: cover;
        width: 100%;
      }
      .brand {
        color: #20e6f3;
        font-size: 13px;
        font-weight: 900;
        letter-spacing: 0;
        margin-top: 22px;
        text-transform: uppercase;
      }
      h1 {
        font-size: clamp(30px, 8vw, 42px);
        line-height: 1.05;
        margin: 10px 0 8px;
      }
      .artist {
        color: #cbd5e1;
        font-size: 17px;
        font-weight: 700;
        margin: 0 0 22px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .button {
        align-items: center;
        background: #20e6f3;
        border: 1px solid #20e6f3;
        border-radius: 8px;
        color: #050506;
        display: inline-flex;
        font-size: 14px;
        font-weight: 900;
        justify-content: center;
        min-height: 46px;
        padding: 0 16px;
        text-decoration: none;
      }
      .button.secondary {
        background: rgba(255, 255, 255, 0.07);
        border-color: rgba(255, 255, 255, 0.16);
        color: #f8fafc;
      }
      .note {
        color: #94a3b8;
        font-size: 13px;
        line-height: 1.5;
        margin-top: 18px;
      }
    </style>
  </head>
  <body>
    <main>
      <img class="artwork" src="${escapeHtml(artworkUrl)}" alt="">
      <p class="brand">TesoHub Music</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="artist">${escapeHtml(artistName)}</p>
      <div class="actions">
        ${storeButton(ANDROID_STORE_URL, "Get Android app")}
        ${storeButton(IOS_STORE_URL, "Get iPhone app")}
      </div>
      <p class="note">Open this link on a phone with TesoHub Music installed to play the song in the app.</p>
    </main>
  </body>
</html>`;
}

function renderUnavailableSongPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Song unavailable - TesoHub Music</title>
    <style>
      :root { color-scheme: dark; }
      body {
        align-items: center;
        background: #050506;
        color: #f8fafc;
        display: flex;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
        padding: 24px;
        text-align: center;
      }
      main { max-width: 420px; }
      h1 { font-size: 30px; margin: 0 0 10px; }
      p { color: #cbd5e1; line-height: 1.5; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>This song is no longer available.</h1>
      <p>It may have been removed or unpublished by TesoHub Music.</p>
    </main>
  </body>
</html>`;
}

function likeCount(db, songId) {
  return db.songLikes.filter((like) => Number(like.song) === Number(songId))
    .length;
}

function followerCount(db, artistId) {
  return db.artistFollows.filter(
    (follow) => Number(follow.artist) === Number(artistId),
  ).length;
}

function serializeSong(db, req, song) {
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(song.artist),
  );
  return {
    id: song.id,
    artist: song.artist,
    artist_name: artist?.name || "",
    artist_category: artist?.category || "",
    title: song.title,
    audio_file: absoluteUrl(req, song.audio_file),
    cover_image: absoluteUrl(req, song.cover_image),
    genre: song.genre || "",
    genre_note: song.genre_note || "",
    lyrics: song.lyrics || "",
    like_count: likeCount(db, song.id),
    play_count: Number(song.play_count || 0),
    release_date: song.release_date || null,
    is_featured: Boolean(song.is_featured),
    created_at: song.created_at,
  };
}

function serializeArtist(db, req, artist, includeSongs = false) {
  const songs = db.songs.filter(
    (song) => Number(song.artist) === Number(artist.id),
  );
  const serialized = {
    id: artist.id,
    name: artist.name,
    category: artist.category || "",
    bio: artist.bio || "",
    photo: absoluteUrl(req, artist.photo),
    location: artist.location || "",
    is_featured: Boolean(artist.is_featured),
    follower_count: followerCount(db, artist.id),
    song_count: songs.length,
    created_at: artist.created_at,
  };

  if (includeSongs) {
    serialized.songs = songs.map((song) => serializeSong(db, req, song));
  }

  return serialized;
}

function playlistEntriesFor(db, playlistId) {
  return db.playlistSongs
    .filter((entry) => Number(entry.playlist) === Number(playlistId))
    .sort((first, second) => {
      if (Number(first.position || 0) !== Number(second.position || 0)) {
        return Number(first.position || 0) - Number(second.position || 0);
      }
      return String(first.added_at || "").localeCompare(String(second.added_at || ""));
    });
}

function serializePlaylist(db, req, playlist, includeSongs = false) {
  const owner = db.listeners.find(
    (listener) => Number(listener.id) === Number(playlist.owner),
  );
  const entries = playlistEntriesFor(db, playlist.id);
  const serialized = {
    id: playlist.id,
    owner: playlist.owner,
    owner_name: owner?.name || "TesoHub listener",
    name: playlist.name || "Untitled Playlist",
    description: playlist.description || "",
    artwork: absoluteUrl(req, playlist.artwork),
    song_count: entries.length,
    created_at: playlist.created_at,
    updated_at: playlist.updated_at,
  };

  if (includeSongs) {
    serialized.songs = entries
      .map((entry) => {
        const song = db.songs.find((item) => Number(item.id) === Number(entry.song));
        return song
          ? {
              ...serializeSong(db, req, song),
              playlist_position: entry.position,
              playlist_added_at: entry.added_at,
            }
          : null;
      })
      .filter(Boolean);
  }

  return serialized;
}

function findOwnedPlaylist(db, listener, playlistId) {
  if (!listener) return null;
  return db.playlists.find(
    (playlist) =>
      Number(playlist.id) === Number(playlistId) &&
      Number(playlist.owner) === Number(listener.id),
  );
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isFutureReleaseDate(value) {
  const releaseDate = cleanText(value);
  if (!releaseDate) return false;
  return releaseDate > todayKey();
}

function latestApplicationForListener(db, listenerId) {
  return [...db.artistApplications]
    .filter((application) => Number(application.listener) === Number(listenerId))
    .sort((first, second) => Number(second.id) - Number(first.id))[0];
}

function publicListener(listener) {
  if (!listener) return null;
  return {
    id: listener.id,
    name: listener.name || "",
    email: listener.email || "",
    phone: listener.phone || "",
    role: listener.role || "listener",
  };
}

function serializeArtistApplication(db, req, application) {
  const listener = db.listeners.find(
    (item) => Number(item.id) === Number(application.listener),
  );
  const artist = application.artist
    ? db.artists.find((item) => Number(item.id) === Number(application.artist))
    : null;

  return {
    id: application.id,
    listener: application.listener,
    applicant: publicListener(listener),
    artist: artist ? serializeArtist(db, req, artist) : null,
    artist_name: application.artist_name || "",
    contact_name: application.contact_name || "",
    bio: application.bio || "",
    country: application.country || "",
    region: application.region || "",
    genre: application.genre || "",
    genre_note: application.genre_note || "",
    phone: application.phone || "",
    email: application.email || "",
    photo: absoluteUrl(req, application.photo),
    social_link: application.social_link || "",
    genuine_confirmed: Boolean(application.genuine_confirmed),
    status: application.status || "pending",
    review_reason: application.review_reason || "",
    rejection_reason: application.rejection_reason || "",
    created_at: application.created_at,
    updated_at: application.updated_at,
    reviewed_at: application.reviewed_at || null,
  };
}

function serializeCompactArtistApplication(application) {
  if (!application) return null;
  return {
    id: application.id,
    artist_name: application.artist_name || "",
    status: application.status || "pending",
    review_reason: application.review_reason || "",
    rejection_reason: application.rejection_reason || "",
    created_at: application.created_at,
    updated_at: application.updated_at,
    reviewed_at: application.reviewed_at || null,
  };
}

function serializeRelease(db, req, release) {
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(release.artist),
  );
  const listener = db.listeners.find(
    (item) => Number(item.id) === Number(release.listener),
  );
  const publicSong = release.public_song
    ? db.songs.find((song) => Number(song.id) === Number(release.public_song))
    : null;

  return {
    id: release.id,
    artist: release.artist,
    artist_name: artist?.name || "",
    artist_profile: artist ? serializeArtist(db, req, artist) : null,
    listener: publicListener(listener),
    title: release.title || "",
    release_type: release.release_type || "Single",
    featured_artist: release.featured_artist || "",
    genre: release.genre || "",
    genre_note: release.genre_note || "",
    language: release.language || "",
    release_date: release.release_date || "",
    explicit: Boolean(release.explicit),
    producer: release.producer || "",
    songwriter: release.songwriter || "",
    description: release.description || "",
    rights_confirmed: Boolean(release.rights_confirmed),
    audio_file: absoluteUrl(req, release.audio_file),
    cover_image: absoluteUrl(req, release.cover_image),
    status: release.status || "draft",
    rejection_reason: release.rejection_reason || "",
    review_reason: release.review_reason || "",
    public_song: publicSong ? serializeSong(db, req, publicSong) : null,
    submitted_at: release.submitted_at || null,
    approved_at: release.approved_at || null,
    published_at: release.published_at || null,
    created_at: release.created_at,
    updated_at: release.updated_at,
  };
}

function publishRelease(db, release) {
  if (!release) return false;

  if (release.public_song) {
    release.status = "published";
    release.published_at = release.published_at || new Date().toISOString();
    release.updated_at = release.updated_at || release.published_at;
    return false;
  }

  const now = new Date().toISOString();
  const song = {
    id: db.nextIds.song++,
    artist: Number(release.artist),
    title: release.title || "Untitled Song",
    audio_file: release.audio_file || "",
    cover_image: release.cover_image || "",
    genre: release.genre || "",
    genre_note: release.genre_note || "",
    lyrics: "",
    play_count: 0,
    release_date: release.release_date || "",
    is_featured: false,
    source_release_id: release.id,
    created_at: now,
  };
  db.songs.push(song);
  release.public_song = song.id;
  release.status = "published";
  release.published_at = now;
  release.updated_at = now;
  return true;
}

function publishDueReleases(db) {
  let changed = false;
  for (const release of db.releases) {
    if (release.status === "scheduled" && !isFutureReleaseDate(release.release_date)) {
      changed = publishRelease(db, release) || changed;
    }
  }
  return changed;
}

async function loadDbWithPublishedReleases() {
  const db = await loadDb();
  if (publishDueReleases(db)) {
    await saveDb(db);
  }
  return db;
}

function makeHubSearchDocuments(db, req) {
  const artistDocuments = db.artists.map((artist) => {
    const songs = db.songs.filter(
      (song) => Number(song.artist) === Number(artist.id),
    );

    return {
      id: `music_artist_${artist.id}`,
      entity_type: "music_artist",
      entity_id: artist.id,
      title: artist.name,
      subtitle: artist.category || "Teso Artist",
      description:
        artist.bio || `${artist.name} is a Teso music artist on TesoHub Music.`,
      category: "Music",
      type: "Artist",
      district: artist.location || "Teso",
      tags: [
        "music",
        "artist",
        "teso",
        artist.name,
        artist.category || "",
        artist.location || "",
      ].filter(Boolean),
      image_url: absoluteUrl(req, artist.photo),
      web_url: `/preview/music_artist_${artist.id}`,
      app_deep_link: `tesohubmusic://artist/${artist.id}`,
      is_verified: Boolean(artist.is_featured),
      popularity_score: followerCount(db, artist.id) + songs.length,
      is_active: true,
      source: "tesohub-music",
      created_at: artist.created_at,
    };
  });

  const songDocuments = db.songs.map((song) => {
    const artist = db.artists.find(
      (item) => Number(item.id) === Number(song.artist),
    );

    return {
      id: `music_song_${song.id}`,
      entity_type: "music_track",
      entity_id: song.id,
      title: song.title,
      subtitle: artist?.name ? `By ${artist.name}` : "Teso Music",
      description: `${song.title} by ${
        artist?.name || "a Teso artist"
      }. ${song.genre || "Teso music"} available on TesoHub Music.`,
      category: "Music",
      type: "Song",
      district: artist?.location || "Teso",
      tags: [
        "music",
        "song",
        "teso",
        song.title,
        song.genre || "",
        artist?.name || "",
        artist?.category || "",
        artist?.location || "",
      ].filter(Boolean),
      image_url: absoluteUrl(req, song.cover_image),
      web_url: `/preview/music_song_${song.id}`,
      app_deep_link: `tesohubmusic://song/${song.id}`,
      is_verified: Boolean(song.is_featured),
      popularity_score: Number(song.play_count || 0) + likeCount(db, song.id),
      is_active: true,
      source: "tesohub-music",
      created_at: song.created_at,
    };
  });

  return [...songDocuments, ...artistDocuments];
}
function sortArtists(artists) {
  return [...artists].sort((first, second) =>
    first.name.localeCompare(second.name),
  );
}

function sortSongs(songs) {
  return [...songs].sort((first, second) => {
    if (Number(second.is_featured) !== Number(first.is_featured)) {
      return Number(second.is_featured) - Number(first.is_featured);
    }
    if (Number(second.play_count) !== Number(first.play_count)) {
      return Number(second.play_count) - Number(first.play_count);
    }
    return first.title.localeCompare(second.title);
  });
}

function getDeviceId(req) {
  return String(req.body?.device_id || req.query?.device_id || "").trim();
}

function requireAdmin(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ detail: "Admin login required." });
  }
  req.adminUser = { role: "admin", username: ADMIN_USERNAME };
  next();
}

function requireListener(db, req, res) {
  const listener = findListenerByToken(db, req);
  if (!listener) {
    res.status(401).json({ detail: "Login required." });
    return null;
  }
  return listener;
}

function requireArtist(db, req, res) {
  const listener = requireListener(db, req, res);
  if (!listener) return null;

  if (listener.role !== "artist" || !listener.artist_id) {
    res.status(403).json({ detail: "Approved artist account required." });
    return null;
  }

  const artist = db.artists.find(
    (item) => Number(item.id) === Number(listener.artist_id),
  );
  if (!artist) {
    res.status(403).json({ detail: "Artist profile is not linked." });
    return null;
  }

  return { listener, artist };
}

function boolValue(value) {
  return value === true || value === "true" || value === "on" || value === "1";
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeGenre(value) {
  const cleanGenre = cleanText(value);
  if (!cleanGenre) return "";

  const knownGenre = GENRE_OPTIONS.find(
    (genre) => genre.toLowerCase() === cleanGenre.toLowerCase(),
  );
  return knownGenre || "Other";
}

function genrePayload(req) {
  const submittedGenre = cleanText(req.body?.genre);
  const genre = normalizeGenre(submittedGenre);
  const submittedNote = cleanText(req.body?.genre_note);
  const genreNote =
    submittedNote ||
    (genre === "Other" && submittedGenre.toLowerCase() !== "other"
      ? submittedGenre
      : "");

  return {
    genre,
    genre_note: genre === "Other" || genre === "Not sure" ? genreNote : "",
  };
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function normalizePhone(value) {
  return cleanText(value).replace(/[^\d+]/g, "");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .pbkdf2Sync(String(password), salt, 120000, 32, "sha256")
    .toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash = "") {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = hashPassword(password, salt).split(":")[1];
  if (actualHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createAuthSession(db, listener, deviceId = "", deviceName = "") {
  const now = new Date().toISOString();
  const token = crypto.randomBytes(32).toString("hex");
  db.authTokens.push({
    id: crypto.randomUUID(),
    token_hash: hashToken(token),
    listener: listener.id,
    device_id: cleanText(deviceId),
    device_name: cleanText(deviceName),
    created_at: now,
    last_active_at: now,
  });
  return token;
}

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

function findListenerByToken(db, req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = db.authTokens.find((item) => item.token_hash === tokenHash);
  if (!session) return null;
  session.last_active_at = new Date().toISOString();
  return db.listeners.find(
    (listener) => Number(listener.id) === Number(session.listener),
  );
}

function findListenerByIdentifier(db, identifier) {
  const cleanIdentifier = cleanText(identifier);
  const email = normalizeEmail(cleanIdentifier);
  const phone = normalizePhone(cleanIdentifier);
  return db.listeners.find(
    (listener) =>
      (email && listener.email === email) ||
      (phone && listener.phone === phone),
  );
}

function serializeListener(db, listener) {
  const latestApplication = latestApplicationForListener(db, listener.id);
  const likedSongIds = db.songLikes
    .filter((like) => Number(like.listener) === Number(listener.id))
    .map((like) => Number(like.song));
  const followedArtistIds = db.artistFollows
    .filter((follow) => Number(follow.listener) === Number(listener.id))
    .map((follow) => Number(follow.artist));

  return {
    id: listener.id,
    name: listener.name,
    email: listener.email || "",
    phone: listener.phone || "",
    role: listener.role || "listener",
    artist_id: listener.artist_id || null,
    artist_application: serializeCompactArtistApplication(latestApplication),
    liked_song_ids: [...new Set(likedSongIds)],
    followed_artist_ids: [...new Set(followedArtistIds)],
    created_at: listener.created_at,
    updated_at: listener.updated_at,
  };
}

function attachDeviceEngagement(db, listener, deviceId) {
  if (!deviceId || !listener) return;
  for (const like of db.songLikes) {
    if (like.device_id === deviceId) {
      like.listener = listener.id;
    }
  }
  for (const follow of db.artistFollows) {
    if (follow.device_id === deviceId) {
      follow.listener = listener.id;
    }
  }
}

function authResponse(db, listener, token) {
  return {
    token,
    listener: serializeListener(db, listener),
  };
}

function applicationPayload(req) {
  const genreData = genrePayload(req);
  return {
    artist_name: cleanText(req.body?.artist_name),
    contact_name: cleanText(req.body?.contact_name),
    bio: cleanText(req.body?.bio),
    country: cleanText(req.body?.country),
    region: cleanText(req.body?.region),
    genre: genreData.genre,
    genre_note: genreData.genre_note,
    phone: normalizePhone(req.body?.phone),
    email: normalizeEmail(req.body?.email),
    social_link: cleanText(req.body?.social_link),
    genuine_confirmed: boolValue(req.body?.genuine_confirmed),
  };
}

function validateArtistApplication(payload, hasPhoto) {
  if (payload.artist_name.length < 2) return "Enter your artist/stage name.";
  if (payload.contact_name.length < 2) return "Enter your real/contact name.";
  if (payload.bio.length < 20) return "Write a short artist biography.";
  if (!payload.country) return "Enter your country.";
  if (!payload.region) return "Enter your region/location.";
  if (!payload.genre) return "Enter your primary genre.";
  if (!payload.phone) return "Enter your phone number.";
  if (!payload.email) return "Enter your email address.";
  if (!hasPhoto) return "Upload a profile photo.";
  if (!payload.genuine_confirmed) {
    return "Confirm that the submitted information is genuine.";
  }
  return "";
}

function releasePayload(req) {
  const genreData = genrePayload(req);
  return {
    title: cleanText(req.body?.title),
    release_type: cleanText(req.body?.release_type) || "Single",
    featured_artist: cleanText(req.body?.featured_artist),
    genre: genreData.genre,
    genre_note: genreData.genre_note,
    language: cleanText(req.body?.language),
    release_date: cleanText(req.body?.release_date),
    explicit: boolValue(req.body?.explicit),
    producer: cleanText(req.body?.producer),
    songwriter: cleanText(req.body?.songwriter),
    description: cleanText(req.body?.description),
    rights_confirmed: boolValue(req.body?.rights_confirmed),
  };
}

function assignReleasePayload(release, payload) {
  for (const [key, value] of Object.entries(payload)) {
    release[key] = value;
  }
}

function validateReleaseForSubmit(release) {
  if (!cleanText(release.title)) return "Enter the song title.";
  if (!release.audio_file) return "Upload an audio file.";
  if (!release.cover_image) return "Upload cover artwork.";
  if (!cleanText(release.genre)) return "Enter the genre.";
  if (!cleanText(release.language)) return "Enter the language.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(release.release_date))) {
    return "Choose a valid release date.";
  }
  if (!release.rights_confirmed) {
    return "Confirm that you own or control the rights.";
  }
  return "";
}

function releaseCanBeEdited(release) {
  return release.status === "draft" || release.status === "rejected";
}

function submitReleaseForReview(release) {
  const now = new Date().toISOString();
  release.status = "under_review";
  release.submitted_at = now;
  release.rejection_reason = "";
  release.review_reason = "";
  release.updated_at = now;
}

function createArtistFromApplication(db, application) {
  const now = new Date().toISOString();
  const existingArtist = application.artist
    ? db.artists.find((artist) => Number(artist.id) === Number(application.artist))
    : null;
  if (existingArtist) return existingArtist;

  const location = [application.region, application.country]
    .filter(Boolean)
    .join(", ");
  const artist = {
    id: db.nextIds.artist++,
    name: application.artist_name,
    category: application.genre || "Other Secular Artists",
    bio: application.bio || "",
    photo: application.photo || "",
    location,
    is_featured: false,
    owner_listener: application.listener,
    source_application_id: application.id,
    created_at: now,
  };
  db.artists.push(artist);
  return artist;
}

app.get("/", (req, res) => {
  res.redirect("/admin/");
});

app.get("/.well-known/assetlinks.json", (req, res) => {
  if (ANDROID_SHA256_CERT_FINGERPRINTS.length === 0) {
    return res.status(404).json({
      detail:
        "Configure ANDROID_SHA256_CERT_FINGERPRINTS before enabling Android App Links verification.",
    });
  }

  res.type("application/json").send(
    JSON.stringify(
      [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: ANDROID_PACKAGE_NAME,
            sha256_cert_fingerprints: ANDROID_SHA256_CERT_FINGERPRINTS,
          },
        },
      ],
      null,
      2,
    ),
  );
});

app.get("/.well-known/apple-app-site-association", (req, res) => {
  if (!IOS_TEAM_ID || !IOS_BUNDLE_IDENTIFIER) {
    return res.status(404).json({
      detail:
        "Configure IOS_TEAM_ID and IOS_BUNDLE_IDENTIFIER before enabling iOS Universal Links.",
    });
  }

  res.type("application/json").send(
    JSON.stringify(
      {
        applinks: {
          apps: [],
          details: [
            {
              appID: `${IOS_TEAM_ID}.${IOS_BUNDLE_IDENTIFIER}`,
              paths: ["/song/*"],
            },
          ],
        },
      },
      null,
      2,
    ),
  );
});

app.get("/song/:id", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const song = db.songs.find(
    (item) => Number(item.id) === Number(req.params.id),
  );

  if (!song) {
    trackProductEvent("shared_song_opened", {
      available: false,
      song_id: req.params.id,
    });
    return res.status(404).type("html").send(renderUnavailableSongPage());
  }

  trackProductEvent("shared_song_opened", {
    available: true,
    song_id: song.id,
  });
  res.type("html").send(renderSongLandingPage(req, db, song));
});

app.post("/api/auth/register/", async (req, res) => {
  const db = await loadDb();
  const name = cleanText(req.body?.name);
  const email = normalizeEmail(req.body?.email);
  const phone = normalizePhone(req.body?.phone);
  const password = String(req.body?.password || "");
  const deviceId = cleanText(req.body?.device_id);
  const deviceName = cleanText(req.body?.device_name);

  if (name.length < 2) {
    return res.status(400).json({ detail: "Enter your profile name." });
  }
  if (!email && !phone) {
    return res.status(400).json({ detail: "Enter an email or phone number." });
  }
  if (password.length < 6) {
    return res.status(400).json({ detail: "Password must be at least 6 characters." });
  }
  if (
    db.listeners.some(
      (listener) =>
        (email && listener.email === email) || (phone && listener.phone === phone),
    )
  ) {
    return res.status(409).json({ detail: "An account already exists." });
  }

  const now = new Date().toISOString();
  const listener = {
    id: db.nextIds.listener++,
    name,
    email,
    phone,
    password_hash: hashPassword(password),
    role: "listener",
    artist_id: null,
    artist_application_id: null,
    created_at: now,
    updated_at: now,
  };
  db.listeners.push(listener);
  attachDeviceEngagement(db, listener, deviceId);
  const token = createAuthSession(db, listener, deviceId, deviceName);
  await saveDb(db);
  res.status(201).json(authResponse(db, listener, token));
});

app.post("/api/auth/login/", async (req, res) => {
  const db = await loadDb();
  const identifier = cleanText(req.body?.identifier || req.body?.email || req.body?.phone);
  const password = String(req.body?.password || "");
  const deviceId = cleanText(req.body?.device_id);
  const deviceName = cleanText(req.body?.device_name);
  const listener = findListenerByIdentifier(db, identifier);

  if (!listener || !verifyPassword(password, listener.password_hash)) {
    return res.status(401).json({ detail: "Invalid login details." });
  }

  attachDeviceEngagement(db, listener, deviceId);
  const token = createAuthSession(db, listener, deviceId, deviceName);
  await saveDb(db);
  res.json(authResponse(db, listener, token));
});

app.get("/api/auth/me/", async (req, res) => {
  const db = await loadDb();
  const listener = findListenerByToken(db, req);
  if (!listener) {
    return res.status(401).json({ detail: "Login required." });
  }
  await saveDb(db);
  res.json({ listener: serializeListener(db, listener) });
});

app.put("/api/auth/me/", async (req, res) => {
  const db = await loadDb();
  const listener = findListenerByToken(db, req);
  if (!listener) {
    return res.status(401).json({ detail: "Login required." });
  }

  const nextName = cleanText(req.body?.name);
  const nextEmail = normalizeEmail(req.body?.email);
  const nextPhone = normalizePhone(req.body?.phone);

  if (nextName.length < 2) {
    return res.status(400).json({ detail: "Enter your profile name." });
  }
  if (!nextEmail && !nextPhone) {
    return res.status(400).json({ detail: "Enter an email or phone number." });
  }
  const duplicate = db.listeners.find(
    (item) =>
      Number(item.id) !== Number(listener.id) &&
      ((nextEmail && item.email === nextEmail) ||
        (nextPhone && item.phone === nextPhone)),
  );
  if (duplicate) {
    return res.status(409).json({ detail: "Those login details are already used." });
  }

  listener.name = nextName;
  listener.email = nextEmail;
  listener.phone = nextPhone;
  listener.updated_at = new Date().toISOString();
  await saveDb(db);
  res.json({ listener: serializeListener(db, listener) });
});

app.post("/api/auth/logout/", async (req, res) => {
  const db = await loadDb();
  const token = getBearerToken(req);
  if (token) {
    const tokenHash = hashToken(token);
    db.authTokens = db.authTokens.filter((item) => item.token_hash !== tokenHash);
    await saveDb(db);
  }
  res.json({ logged_out: true });
});

app.get("/api/artist-applications/me/", async (req, res) => {
  const db = await loadDb();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const application = latestApplicationForListener(db, listener.id);
  res.json({
    application: application
      ? serializeArtistApplication(db, req, application)
      : null,
    listener: serializeListener(db, listener),
  });
});

app.post(
  "/api/artist-applications/",
  upload.single("photo_file"),
  async (req, res) => {
    const db = await loadDb();
    const listener = requireListener(db, req, res);
    if (!listener) return;

    if (listener.role === "artist") {
      return res.status(409).json({ detail: "This account is already an artist." });
    }
    if (listener.role === "artist_pending") {
      return res.status(409).json({ detail: "Your application is already under review." });
    }

    const latestApplication = latestApplicationForListener(db, listener.id);
    if (latestApplication?.status === "pending") {
      listener.role = "artist_pending";
      listener.artist_application_id = latestApplication.id;
      await saveDb(db);
      return res.status(409).json({ detail: "Your application is already under review." });
    }

    const payload = applicationPayload(req);
    const validationError = validateArtistApplication(payload, Boolean(req.file));
    if (validationError) {
      return res.status(400).json({ detail: validationError });
    }

    const now = new Date().toISOString();
    const application = {
      id: db.nextIds.artistApplication++,
      listener: listener.id,
      ...payload,
      photo: uploadUrlFor(req.file),
      status: "pending",
      review_reason: "",
      rejection_reason: "",
      artist: null,
      created_at: now,
      updated_at: now,
      reviewed_at: null,
      reviewed_by: "",
    };
    db.artistApplications.push(application);
    listener.role = "artist_pending";
    listener.artist_application_id = application.id;
    listener.updated_at = now;
    await saveDb(db);
    res.status(201).json({
      application: serializeArtistApplication(db, req, application),
      listener: serializeListener(db, listener),
    });
  },
);

app.get("/api/artist-studio/dashboard/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const account = requireArtist(db, req, res);
  if (!account) return;

  const releases = db.releases.filter(
    (release) => Number(release.artist) === Number(account.artist.id),
  );
  const publicSongs = db.songs.filter(
    (song) => Number(song.artist) === Number(account.artist.id),
  );
  const sortedReleases = [...releases].sort((first, second) =>
    String(second.created_at || "").localeCompare(String(first.created_at || "")),
  );

  res.json({
    artist: serializeArtist(db, req, account.artist),
    follower_count: followerCount(db, account.artist.id),
    total_releases: releases.length,
    published_releases: releases.filter((release) => release.status === "published")
      .length,
    total_plays: publicSongs.reduce(
      (total, song) => total + numberOrZero(song.play_count),
      0,
    ),
    latest_release: sortedReleases[0]
      ? serializeRelease(db, req, sortedReleases[0])
      : null,
  });
});

app.get("/api/artist-studio/releases/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const account = requireArtist(db, req, res);
  if (!account) return;

  const status = cleanText(req.query?.status);
  const releases = db.releases
    .filter((release) => Number(release.artist) === Number(account.artist.id))
    .filter((release) => !status || release.status === status)
    .sort((first, second) =>
      String(second.created_at || "").localeCompare(String(first.created_at || "")),
    );

  res.json(releases.map((release) => serializeRelease(db, req, release)));
});

app.post(
  "/api/artist-studio/releases/",
  upload.fields([
    { name: "audio_upload", maxCount: 1 },
    { name: "cover_upload", maxCount: 1 },
  ]),
  async (req, res) => {
    const db = await loadDb();
    const account = requireArtist(db, req, res);
    if (!account) return;

    const now = new Date().toISOString();
    const release = {
      id: db.nextIds.release++,
      artist: account.artist.id,
      listener: account.listener.id,
      title: "",
      release_type: "Single",
      featured_artist: "",
      genre: "",
      language: "",
      release_date: "",
      explicit: false,
      producer: "",
      songwriter: "",
      description: "",
      rights_confirmed: false,
      audio_file: uploadUrlFor(req.files?.audio_upload?.[0]),
      cover_image: uploadUrlFor(req.files?.cover_upload?.[0]),
      status: "draft",
      rejection_reason: "",
      review_reason: "",
      public_song: null,
      submitted_at: null,
      approved_at: null,
      published_at: null,
      created_at: now,
      updated_at: now,
    };
    assignReleasePayload(release, releasePayload(req));
    release.release_type = "Single";

    if (boolValue(req.body?.submit_for_review)) {
      const validationError = validateReleaseForSubmit(release);
      if (validationError) {
        return res.status(400).json({ detail: validationError });
      }
      submitReleaseForReview(release);
    }

    db.releases.push(release);
    await saveDb(db);
    res.status(201).json(serializeRelease(db, req, release));
  },
);

app.put(
  "/api/artist-studio/releases/:id/",
  upload.fields([
    { name: "audio_upload", maxCount: 1 },
    { name: "cover_upload", maxCount: 1 },
  ]),
  async (req, res) => {
    const db = await loadDb();
    const account = requireArtist(db, req, res);
    if (!account) return;

    const release = db.releases.find(
      (item) =>
        Number(item.id) === Number(req.params.id) &&
        Number(item.artist) === Number(account.artist.id),
    );
    if (!release) return res.status(404).json({ detail: "Release not found." });
    if (!releaseCanBeEdited(release)) {
      return res
        .status(403)
        .json({ detail: "Only draft or rejected releases can be edited." });
    }

    assignReleasePayload(release, releasePayload(req));
    release.release_type = "Single";
    release.audio_file =
      uploadUrlFor(req.files?.audio_upload?.[0]) || release.audio_file;
    release.cover_image =
      uploadUrlFor(req.files?.cover_upload?.[0]) || release.cover_image;
    release.updated_at = new Date().toISOString();

    if (boolValue(req.body?.submit_for_review)) {
      const validationError = validateReleaseForSubmit(release);
      if (validationError) {
        return res.status(400).json({ detail: validationError });
      }
      submitReleaseForReview(release);
    }

    await saveDb(db);
    res.json(serializeRelease(db, req, release));
  },
);

app.post("/api/artist-studio/releases/:id/submit/", async (req, res) => {
  const db = await loadDb();
  const account = requireArtist(db, req, res);
  if (!account) return;

  const release = db.releases.find(
    (item) =>
      Number(item.id) === Number(req.params.id) &&
      Number(item.artist) === Number(account.artist.id),
  );
  if (!release) return res.status(404).json({ detail: "Release not found." });
  if (!releaseCanBeEdited(release)) {
    return res
      .status(403)
      .json({ detail: "Only draft or rejected releases can be submitted." });
  }

  const validationError = validateReleaseForSubmit(release);
  if (validationError) return res.status(400).json({ detail: validationError });

  submitReleaseForReview(release);
  await saveDb(db);
  res.json(serializeRelease(db, req, release));
});

app.put(
  "/api/artist-studio/profile/",
  upload.single("photo_file"),
  async (req, res) => {
    const db = await loadDb();
    const account = requireArtist(db, req, res);
    if (!account) return;

    account.artist.bio = cleanText(req.body?.bio) || account.artist.bio;
    account.artist.category =
      cleanText(req.body?.category) || account.artist.category;
    account.artist.location =
      cleanText(req.body?.location) || account.artist.location;
    account.artist.photo = uploadUrlFor(req.file) || account.artist.photo;
    account.artist.updated_at = new Date().toISOString();
    await saveDb(db);
    res.json(serializeArtist(db, req, account.artist));
  },
);

app.get("/api/artists/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const category = String(req.query.category || "").toLowerCase();
  const search = String(req.query.search || "").toLowerCase();
  const artists = sortArtists(db.artists).filter((artist) => {
    const categoryMatches =
      !category || artist.category.toLowerCase() === category;
    const searchMatches = !search || artist.name.toLowerCase().includes(search);
    return categoryMatches && searchMatches;
  });
  res.json(artists.map((artist) => serializeArtist(db, req, artist)));
});

app.get("/api/artists/:id/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  res.json(serializeArtist(db, req, artist, true));
});

app.get("/api/songs/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const category = String(req.query.category || "").toLowerCase();
  const search = String(req.query.search || "").toLowerCase();
  const songs = sortSongs(db.songs).filter((song) => {
    const artist = db.artists.find(
      (item) => Number(item.id) === Number(song.artist),
    );
    const categoryMatches =
      !category || artist?.category?.toLowerCase() === category;
    const searchMatches =
      !search ||
      song.title.toLowerCase().includes(search) ||
      artist?.name?.toLowerCase().includes(search);
    return categoryMatches && searchMatches;
  });
  res.json(songs.map((song) => serializeSong(db, req, song)));
});
app.get("/api/hub/search-documents/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const search = String(req.query.q || "").toLowerCase();

  let documents = makeHubSearchDocuments(db, req);

  if (search) {
    documents = documents.filter((item) => {
      const text = [
        item.title,
        item.subtitle,
        item.description,
        item.category,
        item.type,
        item.district,
        ...(item.tags || []),
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(search);
    });
  }

  res.json(documents);
});
app.get("/api/songs/:id/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const song = db.songs.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!song) return res.status(404).json({ detail: "Song not found." });
  res.json(serializeSong(db, req, song));
});

app.post("/api/songs/:id/play/", async (req, res) => {
  try {
    const db = await loadDbWithPublishedReleases();
    const song = db.songs.find(
      (item) => Number(item.id) === Number(req.params.id),
    );

    if (!song) {
      return res.status(404).json({ detail: "Song not found." });
    }

    song.play_count = numberOrZero(song.play_count) + 1;
    await saveDb(db);

    res.json({
      id: song.id,
      play_count: song.play_count,
      song: serializeSong(db, req, song),
    });
  } catch (error) {
    console.error("Failed to record song play:", error);
    res.status(500).json({ detail: "Could not record song play." });
  }
});

app.get("/api/featured-artists/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  res.json(
    sortArtists(db.artists.filter((artist) => artist.is_featured)).map(
      (artist) => serializeArtist(db, req, artist),
    ),
  );
});

app.get("/api/featured-songs/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  res.json(
    sortSongs(db.songs.filter((song) => song.is_featured)).map((song) =>
      serializeSong(db, req, song),
    ),
  );
});

app.get("/api/genres/", (req, res) => {
  res.json(GENRE_OPTIONS);
});

app.get("/api/playlists/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const playlists = db.playlists
    .filter((playlist) => Number(playlist.owner) === Number(listener.id))
    .sort((first, second) =>
      String(second.updated_at || second.created_at || "").localeCompare(
        String(first.updated_at || first.created_at || ""),
      ),
    );
  res.json(playlists.map((playlist) => serializePlaylist(db, req, playlist)));
});

app.post("/api/playlists/", async (req, res) => {
  const db = await loadDb();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const name = cleanText(req.body?.name);
  if (name.length < 1) {
    return res.status(400).json({ detail: "Enter a playlist name." });
  }

  const now = new Date().toISOString();
  const playlist = {
    id: db.nextIds.playlist++,
    owner: listener.id,
    name,
    description: cleanText(req.body?.description),
    artwork: cleanText(req.body?.artwork),
    created_at: now,
    updated_at: now,
  };
  db.playlists.push(playlist);
  await saveDb(db);
  res.status(201).json(serializePlaylist(db, req, playlist, true));
});

app.get("/api/playlists/:id/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const playlist = findOwnedPlaylist(db, listener, req.params.id);
  if (!playlist) return res.status(404).json({ detail: "Playlist not found." });

  res.json(serializePlaylist(db, req, playlist, true));
});

app.put("/api/playlists/:id/", async (req, res) => {
  const db = await loadDb();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const playlist = findOwnedPlaylist(db, listener, req.params.id);
  if (!playlist) return res.status(404).json({ detail: "Playlist not found." });

  const nextName = cleanText(req.body?.name);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "name") && nextName.length < 1) {
    return res.status(400).json({ detail: "Enter a playlist name." });
  }

  if (nextName) playlist.name = nextName;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "description")) {
    playlist.description = cleanText(req.body?.description);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "artwork")) {
    playlist.artwork = cleanText(req.body?.artwork);
  }
  playlist.updated_at = new Date().toISOString();
  await saveDb(db);
  res.json(serializePlaylist(db, req, playlist, true));
});

app.delete("/api/playlists/:id/", async (req, res) => {
  const db = await loadDb();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const playlist = findOwnedPlaylist(db, listener, req.params.id);
  if (!playlist) return res.status(404).json({ detail: "Playlist not found." });

  db.playlists = db.playlists.filter(
    (item) => Number(item.id) !== Number(playlist.id),
  );
  db.playlistSongs = db.playlistSongs.filter(
    (item) => Number(item.playlist) !== Number(playlist.id),
  );
  await saveDb(db);
  res.json({ deleted: true });
});

app.post("/api/playlists/:id/songs/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const playlist = findOwnedPlaylist(db, listener, req.params.id);
  if (!playlist) return res.status(404).json({ detail: "Playlist not found." });

  const songId = Number(req.body?.song || req.body?.song_id);
  const song = db.songs.find((item) => Number(item.id) === songId);
  if (!song) return res.status(404).json({ detail: "Song not found." });

  const existing = db.playlistSongs.find(
    (item) =>
      Number(item.playlist) === Number(playlist.id) &&
      Number(item.song) === Number(song.id),
  );
  if (existing) {
    return res.json({
      added: false,
      duplicate: true,
      playlist: serializePlaylist(db, req, playlist, true),
    });
  }

  const entries = playlistEntriesFor(db, playlist.id);
  const nextPosition =
    entries.reduce(
      (maxPosition, item) => Math.max(maxPosition, Number(item.position || 0)),
      0,
    ) + 1;
  db.playlistSongs.push({
    playlist: playlist.id,
    song: song.id,
    position: nextPosition,
    added_at: new Date().toISOString(),
  });
  playlist.updated_at = new Date().toISOString();
  await saveDb(db);
  res.status(201).json({
    added: true,
    duplicate: false,
    playlist: serializePlaylist(db, req, playlist, true),
  });
});

app.delete("/api/playlists/:id/songs/:songId/", async (req, res) => {
  const db = await loadDb();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const playlist = findOwnedPlaylist(db, listener, req.params.id);
  if (!playlist) return res.status(404).json({ detail: "Playlist not found." });

  const beforeCount = db.playlistSongs.length;
  db.playlistSongs = db.playlistSongs.filter(
    (item) =>
      !(
        Number(item.playlist) === Number(playlist.id) &&
        Number(item.song) === Number(req.params.songId)
      ),
  );
  playlist.updated_at = new Date().toISOString();
  await saveDb(db);
  res.json({
    removed: db.playlistSongs.length !== beforeCount,
    playlist: serializePlaylist(db, req, playlist, true),
  });
});

app.post("/api/songs/:id/like/", async (req, res) => {
  const db = await loadDb();
  const song = db.songs.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  const listener = findListenerByToken(db, req);
  const deviceId = getDeviceId(req);
  if (!song) return res.status(404).json({ detail: "Song not found." });
  if (!deviceId && !listener)
    return res.status(400).json({ detail: "device_id or login is required." });
  const existing = db.songLikes.find(
    (like) =>
      Number(like.song) === Number(song.id) &&
      ((listener && Number(like.listener) === Number(listener.id)) ||
        (deviceId && like.device_id === deviceId)),
  );
  if (existing) {
    if (listener) existing.listener = listener.id;
    if (deviceId && !existing.device_id) existing.device_id = deviceId;
    await saveDb(db);
  } else {
    db.songLikes.push({
      song: song.id,
      device_id: deviceId,
      listener: listener?.id || null,
      created_at: new Date().toISOString(),
    });
    await saveDb(db);
  }
  res.json({ liked: true, like_count: likeCount(db, song.id) });
});

app.post("/api/songs/:id/unlike/", async (req, res) => {
  const db = await loadDb();
  const song = db.songs.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  const listener = findListenerByToken(db, req);
  const deviceId = getDeviceId(req);
  if (!song) return res.status(404).json({ detail: "Song not found." });
  if (!deviceId && !listener)
    return res.status(400).json({ detail: "device_id or login is required." });
  db.songLikes = db.songLikes.filter(
    (like) =>
      !(
        Number(like.song) === Number(song.id) &&
        ((listener && Number(like.listener) === Number(listener.id)) ||
          (deviceId && like.device_id === deviceId))
      ),
  );
  await saveDb(db);
  res.json({ liked: false, like_count: likeCount(db, song.id) });
});

app.post("/api/artists/:id/follow/", async (req, res) => {
  const db = await loadDb();
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  const listener = findListenerByToken(db, req);
  const deviceId = getDeviceId(req);
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  if (!deviceId && !listener)
    return res.status(400).json({ detail: "device_id or login is required." });
  const existing = db.artistFollows.find(
    (follow) =>
      Number(follow.artist) === Number(artist.id) &&
      ((listener && Number(follow.listener) === Number(listener.id)) ||
        (deviceId && follow.device_id === deviceId)),
  );
  if (existing) {
    if (listener) existing.listener = listener.id;
    if (deviceId && !existing.device_id) existing.device_id = deviceId;
    await saveDb(db);
  } else {
    db.artistFollows.push({
      artist: artist.id,
      device_id: deviceId,
      listener: listener?.id || null,
      created_at: new Date().toISOString(),
    });
    await saveDb(db);
  }
  res.json({ followed: true, follower_count: followerCount(db, artist.id) });
});

app.post("/api/artists/:id/unfollow/", async (req, res) => {
  const db = await loadDb();
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  const listener = findListenerByToken(db, req);
  const deviceId = getDeviceId(req);
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  if (!deviceId && !listener)
    return res.status(400).json({ detail: "device_id or login is required." });
  db.artistFollows = db.artistFollows.filter(
    (follow) =>
      !(
        Number(follow.artist) === Number(artist.id) &&
        ((listener && Number(follow.listener) === Number(listener.id)) ||
          (deviceId && follow.device_id === deviceId))
      ),
  );
  await saveDb(db);
  res.json({ followed: false, follower_count: followerCount(db, artist.id) });
});

app.post("/admin-api/login", (req, res) => {
  if (
    req.body?.username === ADMIN_USERNAME &&
    req.body?.password === ADMIN_PASSWORD
  ) {
    return res.json({ token: ADMIN_TOKEN, username: ADMIN_USERNAME });
  }
  return res.status(401).json({ detail: "Invalid admin login." });
});

app.get("/admin-api/artist-applications", requireAdmin, async (req, res) => {
  const db = await loadDb();
  const status = cleanText(req.query?.status);
  const applications = db.artistApplications
    .filter((application) => !status || application.status === status)
    .sort((first, second) =>
      String(second.created_at || "").localeCompare(String(first.created_at || "")),
    );
  res.json(
    applications.map((application) =>
      serializeArtistApplication(db, req, application),
    ),
  );
});

app.post(
  "/admin-api/artist-applications/:id/approve",
  requireAdmin,
  async (req, res) => {
    const db = await loadDb();
    const application = db.artistApplications.find(
      (item) => Number(item.id) === Number(req.params.id),
    );
    if (!application) {
      return res.status(404).json({ detail: "Application not found." });
    }
    if (application.status === "approved") {
      return res.json(serializeArtistApplication(db, req, application));
    }

    const listener = db.listeners.find(
      (item) => Number(item.id) === Number(application.listener),
    );
    if (!listener) {
      return res.status(404).json({ detail: "Applicant account not found." });
    }

    const artist = createArtistFromApplication(db, application);
    const now = new Date().toISOString();
    application.status = "approved";
    application.artist = artist.id;
    application.rejection_reason = "";
    application.review_reason = cleanText(req.body?.review_reason);
    application.reviewed_at = now;
    application.reviewed_by = req.adminUser.username;
    application.updated_at = now;
    listener.role = "artist";
    listener.artist_id = artist.id;
    listener.artist_application_id = application.id;
    listener.updated_at = now;
    await saveDb(db);
    res.json(serializeArtistApplication(db, req, application));
  },
);

app.post(
  "/admin-api/artist-applications/:id/reject",
  requireAdmin,
  async (req, res) => {
    const db = await loadDb();
    const application = db.artistApplications.find(
      (item) => Number(item.id) === Number(req.params.id),
    );
    if (!application) {
      return res.status(404).json({ detail: "Application not found." });
    }

    const reason = cleanText(req.body?.reason || req.body?.rejection_reason);
    if (!reason) return res.status(400).json({ detail: "Enter a rejection reason." });

    const listener = db.listeners.find(
      (item) => Number(item.id) === Number(application.listener),
    );
    const now = new Date().toISOString();
    application.status = "rejected";
    application.rejection_reason = reason;
    application.review_reason = reason;
    application.reviewed_at = now;
    application.reviewed_by = req.adminUser.username;
    application.updated_at = now;
    if (listener && listener.role !== "artist") {
      listener.role = "listener";
      listener.artist_application_id = application.id;
      listener.updated_at = now;
    }
    await saveDb(db);
    res.json(serializeArtistApplication(db, req, application));
  },
);

app.post(
  "/admin-api/artist-applications/:id/request-changes",
  requireAdmin,
  async (req, res) => {
    const db = await loadDb();
    const application = db.artistApplications.find(
      (item) => Number(item.id) === Number(req.params.id),
    );
    if (!application) {
      return res.status(404).json({ detail: "Application not found." });
    }

    const reason = cleanText(req.body?.reason || req.body?.review_reason);
    if (!reason) return res.status(400).json({ detail: "Enter what needs changing." });

    const listener = db.listeners.find(
      (item) => Number(item.id) === Number(application.listener),
    );
    const now = new Date().toISOString();
    application.status = "changes_requested";
    application.review_reason = reason;
    application.rejection_reason = reason;
    application.reviewed_at = now;
    application.reviewed_by = req.adminUser.username;
    application.updated_at = now;
    if (listener && listener.role !== "artist") {
      listener.role = "listener";
      listener.artist_application_id = application.id;
      listener.updated_at = now;
    }
    await saveDb(db);
    res.json(serializeArtistApplication(db, req, application));
  },
);

app.get("/admin-api/releases", requireAdmin, async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const status = cleanText(req.query?.status);
  const releases = db.releases
    .filter((release) => !status || release.status === status)
    .sort((first, second) =>
      String(second.created_at || "").localeCompare(String(first.created_at || "")),
    );
  res.json(releases.map((release) => serializeRelease(db, req, release)));
});

app.get("/admin-api/releases/:id", requireAdmin, async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  const release = db.releases.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!release) return res.status(404).json({ detail: "Release not found." });
  res.json(serializeRelease(db, req, release));
});

app.post("/admin-api/releases/:id/approve", requireAdmin, async (req, res) => {
  const db = await loadDb();
  const release = db.releases.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!release) return res.status(404).json({ detail: "Release not found." });
  if (release.status !== "under_review" && release.status !== "scheduled") {
    return res.status(400).json({ detail: "Only submitted releases can be approved." });
  }

  const validationError = validateReleaseForSubmit(release);
  if (validationError) return res.status(400).json({ detail: validationError });

  const now = new Date().toISOString();
  release.approved_at = release.approved_at || now;
  release.reviewed_by = req.adminUser.username;
  release.rejection_reason = "";
  release.review_reason = cleanText(req.body?.review_reason);
  release.updated_at = now;

  if (isFutureReleaseDate(release.release_date)) {
    release.status = "scheduled";
  } else {
    publishRelease(db, release);
  }

  await saveDb(db);
  res.json(serializeRelease(db, req, release));
});

app.post("/admin-api/releases/:id/reject", requireAdmin, async (req, res) => {
  const db = await loadDb();
  const release = db.releases.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!release) return res.status(404).json({ detail: "Release not found." });
  if (release.status !== "under_review" && release.status !== "scheduled") {
    return res.status(400).json({ detail: "Only submitted releases can be rejected." });
  }

  const reason = cleanText(req.body?.reason || req.body?.rejection_reason);
  if (!reason) return res.status(400).json({ detail: "Enter a rejection reason." });

  const now = new Date().toISOString();
  release.status = "rejected";
  release.rejection_reason = reason;
  release.review_reason = reason;
  release.reviewed_by = req.adminUser.username;
  release.updated_at = now;
  await saveDb(db);
  res.json(serializeRelease(db, req, release));
});

app.get("/admin-api/artists", requireAdmin, async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  res.json(
    sortArtists(db.artists).map((artist) => serializeArtist(db, req, artist)),
  );
});

app.post(
  "/admin-api/artists",
  requireAdmin,
  upload.single("photo_file"),
  async (req, res) => {
    const db = await loadDb();
    const now = new Date().toISOString();
    const artist = {
      id: db.nextIds.artist++,
      name: req.body.name || "Untitled Artist",
      category: req.body.category || "Other Secular Artists",
      bio: req.body.bio || "",
      photo: uploadUrlFor(req.file) || req.body.photo || "",
      location: req.body.location || "",
      is_featured: boolValue(req.body.is_featured),
      created_at: now,
    };
    db.artists.push(artist);
    await saveDb(db);
    res.status(201).json(serializeArtist(db, req, artist));
  },
);

app.put(
  "/admin-api/artists/:id",
  requireAdmin,
  upload.single("photo_file"),
  async (req, res) => {
    const db = await loadDb();
    const artist = db.artists.find(
      (item) => Number(item.id) === Number(req.params.id),
    );
    if (!artist) return res.status(404).json({ detail: "Artist not found." });
    Object.assign(artist, {
      name: req.body.name || artist.name,
      category: req.body.category || artist.category,
      bio: req.body.bio ?? artist.bio,
      photo: uploadUrlFor(req.file) || req.body.photo || artist.photo,
      location: req.body.location ?? artist.location,
      is_featured: boolValue(req.body.is_featured),
    });
    await saveDb(db);
    res.json(serializeArtist(db, req, artist));
  },
);

app.delete("/admin-api/artists/:id", requireAdmin, async (req, res) => {
  const db = await loadDb();
  const id = Number(req.params.id);
  db.artists = db.artists.filter((artist) => Number(artist.id) !== id);
  db.songs = db.songs.filter((song) => Number(song.artist) !== id);
  db.artistFollows = db.artistFollows.filter(
    (follow) => Number(follow.artist) !== id,
  );
  await saveDb(db);
  res.json({ deleted: true });
});

app.get("/admin-api/songs", requireAdmin, async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  res.json(sortSongs(db.songs).map((song) => serializeSong(db, req, song)));
});

app.post(
  "/admin-api/songs",
  requireAdmin,
  upload.fields([
    { name: "audio_upload", maxCount: 1 },
    { name: "cover_upload", maxCount: 1 },
  ]),
  async (req, res) => {
    const db = await loadDb();
    const now = new Date().toISOString();
    const genreData = genrePayload(req);
    const song = {
      id: db.nextIds.song++,
      artist: Number(req.body.artist),
      title: req.body.title || "Untitled Song",
      audio_file:
        uploadUrlFor(req.files?.audio_upload?.[0]) || req.body.audio_file || "",
      cover_image:
        uploadUrlFor(req.files?.cover_upload?.[0]) ||
        req.body.cover_image ||
        "",
      genre: genreData.genre,
      genre_note: genreData.genre_note,
      lyrics: req.body.lyrics || "",
      play_count: numberOrZero(req.body.play_count),
      release_date: req.body.release_date || "",
      is_featured: boolValue(req.body.is_featured),
      created_at: now,
    };
    db.songs.push(song);
    await saveDb(db);
    res.status(201).json(serializeSong(db, req, song));
  },
);

app.put(
  "/admin-api/songs/:id",
  requireAdmin,
  upload.fields([
    { name: "audio_upload", maxCount: 1 },
    { name: "cover_upload", maxCount: 1 },
  ]),
  async (req, res) => {
    const db = await loadDb();
    const song = db.songs.find(
      (item) => Number(item.id) === Number(req.params.id),
    );
    if (!song) return res.status(404).json({ detail: "Song not found." });
    const genreData = Object.prototype.hasOwnProperty.call(req.body || {}, "genre")
      ? genrePayload(req)
      : { genre: song.genre, genre_note: song.genre_note || "" };
    Object.assign(song, {
      artist: Number(req.body.artist || song.artist),
      title: req.body.title || song.title,
      audio_file:
        uploadUrlFor(req.files?.audio_upload?.[0]) ||
        req.body.audio_file ||
        song.audio_file,
      cover_image:
        uploadUrlFor(req.files?.cover_upload?.[0]) ||
        req.body.cover_image ||
        song.cover_image,
      genre: genreData.genre,
      genre_note: genreData.genre_note,
      lyrics: req.body.lyrics ?? song.lyrics,
      play_count: numberOrZero(req.body.play_count ?? song.play_count),
      release_date: req.body.release_date ?? song.release_date,
      is_featured: boolValue(req.body.is_featured),
    });
    await saveDb(db);
    res.json(serializeSong(db, req, song));
  },
);

app.delete("/admin-api/songs/:id", requireAdmin, async (req, res) => {
  const db = await loadDb();
  const id = Number(req.params.id);
  db.songs = db.songs.filter((song) => Number(song.id) !== id);
  db.songLikes = db.songLikes.filter((like) => Number(like.song) !== id);
  await saveDb(db);
  res.json({ deleted: true });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (
    error instanceof multer.MulterError ||
    error?.message?.includes("Upload") ||
    error?.message?.includes("Unsupported upload field") ||
    error?.message?.includes("valid audio") ||
    error?.message?.includes("valid image")
  ) {
    return res.status(400).json({ detail: error.message });
  }

  console.error("Unhandled API error:", error);
  return res.status(500).json({ detail: "Something went wrong." });
});

await ensureDb();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Teso Tunes JS backend running on http://0.0.0.0:${PORT}`);
  console.log(`Admin dashboard: http://127.0.0.1:${PORT}/admin/`);
});
