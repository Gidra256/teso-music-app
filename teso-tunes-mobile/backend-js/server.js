import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import multer from "multer";

import { perfMetricsMiddleware } from "./perfMetrics.js";
import { discoveryOptions, selectDiscovery } from "./discovery.js";
import { createSupabasePersistence } from "./supabasePersistence.js";
import { createAdminAccounts } from "./adminAccounts.js";
import { isShareableSong, renderPublicSongPage } from "./songSharing.js";
import { AUDIO_COOKIE, AUDIO_COOKIE_SECONDS, audioResponseUrl, canReadAudio, makeAudioCookie,
  normalizeAudioInput, publicExternalAudio, validAudioCookie, validAudioId, validObjectPath } from "./audioAccess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_BUCKETS = {
  audio: process.env.SUPABASE_AUDIO_BUCKET || "music-audio",
  artwork: process.env.SUPABASE_ARTWORK_BUCKET || "artwork",
  avatars: process.env.SUPABASE_AVATAR_BUCKET || "avatars",
  supportAttachments:
    process.env.SUPABASE_SUPPORT_ATTACHMENTS_BUCKET || "support-attachments",
};
const HAS_SUPABASE_ENV = Boolean(
  process.env.DATABASE_URL || process.env.SUPABASE_URL || SUPABASE_SECRET_KEY,
);
const PERSISTENCE_BACKEND = (
  process.env.PERSISTENCE_BACKEND ||
  process.env.DATA_BACKEND ||
  (HAS_SUPABASE_ENV ? "supabase" : "json")
).toLowerCase();
const USE_SUPABASE_PERSISTENCE = PERSISTENCE_BACKEND === "supabase";
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : __dirname;
const DATA_DIR = path.join(STORAGE_DIR, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const LEGACY_MEDIA_DIR = path.join(__dirname, "..", "backend", "media");
const PORT = Number(process.env.PORT || 8000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_TOKEN =
  process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString("hex");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const PUBLIC_MUSIC_WEB_URL = (
  process.env.PUBLIC_MUSIC_WEB_URL || "https://tesohub-music-pwa.onrender.com"
).replace(/\/+$/, "");
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
const IOS_BUNDLE_IDENTIFIER =
  process.env.IOS_BUNDLE_IDENTIFIER ||
  process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER ||
  "";
const IOS_TEAM_ID = process.env.IOS_TEAM_ID || "";

function encodeStoragePath(objectPath) {
  return String(objectPath || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function storageUrlFor(bucket, objectPath) {
  return `/api/storage/${encodeURIComponent(bucket)}/${encodeStoragePath(objectPath)}`;
}

const supabasePersistence = createSupabasePersistence({
  databaseUrl: process.env.DATABASE_URL || "",
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  secretKey: SUPABASE_SECRET_KEY,
  buckets: SUPABASE_BUCKETS,
  storageUrlFor,
});

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(perfMetricsMiddleware);
app.use(express.json({ limit: "2mb" }));
app.use("/admin-api", (req, res, next) => adminAccounts.middleware(req, res, next));
app.use(["/api/storage", "/api/songs/:id/audio", "/api/releases/:id/audio", "/uploads", "/media"],
  (req, res, next) => adminAccounts.audioMiddleware(req, res, next));
app.use("/uploads", (req, res, next) => serveLegacyMedia(req, res).catch(next));
app.use("/media", (req, res, next) => serveLegacyMedia(req, res).catch(next));
app.use("/app-assets", express.static(path.join(__dirname, "..", "mobile", "assets")));
app.use("/admin", express.static(path.join(__dirname, "public")));

for (const method of ["get", "post", "put", "delete", "patch"]) {
  const original = app[method].bind(app);
  app[method] = (routePath, ...handlers) =>
    original(
      routePath,
      ...handlers.map((handler) => {
        if (typeof handler !== "function" || handler.length === 4) return handler;
        return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
      }),
    );
}

app.get("/healthz", (req, res) => {
  res.json({
    status: "ok",
    service: "teso-tunes-api",
    persistence_backend: PERSISTENCE_BACKEND,
  });
});

app.get("/api/storage/:bucket/*", async (req, res, next) => {
  try {
    if (!USE_SUPABASE_PERSISTENCE) {
      return res.status(404).json({ detail: "Media not found." });
    }
    await supabasePersistence.streamObject(req, res, audioAccessFor(req));
  } catch (error) {
    next(error);
  }
});

app.get("/api/songs/:id/audio/", (req, res) => serveAudio("song", req, res));
app.get("/api/releases/:id/audio/", (req, res) => serveAudio("release", req, res));

function audioAccessFor(req) {
  const token = getBearerToken(req);
  const admin = req.adminIdentity;
  return {
    tokenHash: token && !admin ? hashToken(token) : "",
    reviewer: { releases: adminCan(admin, "releases"), catalog: adminCan(admin, "catalog") },
  };
}

async function setAudioPreviewCookie(req, res) {
  if (!adminCan(req.adminUser, "releases") && !adminCan(req.adminUser, "catalog")) return;
  if (req.adminSessionHash) return adminAccounts.preview(req, res);
  res.cookie(AUDIO_COOKIE, makeAudioCookie(ADMIN_TOKEN), {
    httpOnly: true, secure: req.secure, sameSite: "strict", path: "/api/",
    maxAge: AUDIO_COOKIE_SECONDS * 1000,
  });
  res.set("cache-control", "no-store");
}

function mediaPath(value) {
  try { return decodeURIComponent(new URL(value, "https://local.invalid").pathname); }
  catch { return ""; }
}

function audioInput(value) {
  return normalizeAudioInput(value, { bucket: SUPABASE_BUCKETS.audio,
    supabaseUrl: process.env.SUPABASE_URL, allowLocal: !USE_SUPABASE_PERSISTENCE });
}

function legacyAudioRows(db, req) {
  const listener = findListenerByToken(db, req);
  return ["song", "release"].flatMap((kind) => (kind === "song" ? db.songs : db.releases).map((item) => {
    const artist = db.artists.find((entry) => Number(entry.id) === Number(item.artist));
    const publishedSong = kind === "song" ? item : db.songs.find((song) =>
      Number(song.id) === Number(item.public_song) && song.audio_file === item.audio_file);
    return { ...item, kind, artist_id: item.artist, artist_status: artist?.status,
      viewer_role: listener?.role, viewer_status: listener?.status, viewer_artist_id: listener?.artist_id,
      is_public: Boolean(publishedSong && isPublicSong(db, publishedSong) &&
        (kind === "song" || item.status === "published")) };
  }));
}

async function sendLocalMedia(value, req, res) {
  const pathname = mediaPath(value);
  const prefix = pathname.startsWith("/uploads/") ? "/uploads/" : "/media/";
  const relative = pathname.slice(prefix.length);
  if (!pathname.startsWith(prefix) || !validObjectPath(relative)) {
    return res.status(404).json({ detail: "Media not found." });
  }
  const root = prefix === "/uploads/" ? UPLOADS_DIR : LEGACY_MEDIA_DIR;
  return res.sendFile(relative, { root, dotfiles: "deny", cacheControl: false }, (error) => {
    if (error && !res.headersSent) res.status(404).json({ detail: "Media not found." });
  });
}

async function serveLegacyMedia(req, res) {
  res.set("cache-control", "private, no-store");
  if (USE_SUPABASE_PERSISTENCE || !["GET", "HEAD"].includes(req.method)) {
    return res.status(404).json({ detail: "Media not found." });
  }
  const pathname = mediaPath(req.originalUrl);
  const db = await loadDb();
  const matching = legacyAudioRows(db, req).filter((row) => mediaPath(row.audio_file) === pathname);
  if (matching.length) {
    if (!matching.some((row) => canReadAudio(row, audioAccessFor(req).reviewer))) {
      return res.status(404).json({ detail: "Media not found." });
    }
  } else {
    const images = [...db.songs, ...db.releases].map((row) => row.cover_image)
      .concat([...db.artists, ...db.artistApplications].map((row) => row.photo));
    if (!images.some((value) => value && mediaPath(value) === pathname)) {
      return res.status(404).json({ detail: "Media not found." });
    }
  }
  return sendLocalMedia(pathname, req, res);
}

async function serveAudio(kind, req, res) {
  res.set("cache-control", "private, no-store");
  if (!validAudioId(req.params.id)) return res.status(404).json({ detail: "Media not found." });
  const access = audioAccessFor(req);
  if (USE_SUPABASE_PERSISTENCE) {
    return supabasePersistence.streamAudio({ kind, value: req.params.id }, req, res, access);
  }
  const db = await loadDb();
  const row = legacyAudioRows(db, req).find((item) => item.kind === kind && Number(item.id) === Number(req.params.id));
  if (!row || !canReadAudio(row, access.reviewer)) return res.status(404).json({ detail: "Media not found." });
  if (/^\/(uploads|media)\//.test(row.audio_file)) return sendLocalMedia(row.audio_file, req, res);
  const external = row.is_public && publicExternalAudio(row.audio_file, process.env.SUPABASE_URL);
  if (external) return res.redirect(302, external);
  return res.status(404).json({ detail: "Media not found." });
}

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const MAX_SUPPORT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
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
const SUPPORT_ATTACHMENT_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".txt",
  ".webp",
]);
const SUPPORT_ATTACHMENT_MIME_PREFIXES = ["image/"];
const SUPPORT_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
]);
const LISTENER_ROLES = new Set(["listener", "artist_pending", "artist"]);
const RELEASE_STATUSES = new Set([
  "draft",
  "under_review",
  "approved",
  "rejected",
  "scheduled",
  "published",
]);
const SONG_STATUSES = new Set(["published", "hidden", "removed", "under_review"]);
const ARTIST_STATUSES = new Set(["active", "suspended", "removed"]);
const LISTENER_STATUSES = new Set(["active", "suspended"]);
const REPORT_STATUSES = new Set(["open", "reviewing", "resolved", "dismissed"]);
const SUPPORT_TICKET_STATUSES = new Set([
  "open",
  "in_progress",
  "waiting_on_user",
  "resolved",
  "closed",
]);
const SUPPORT_TICKET_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const LISTENER_SUPPORT_CATEGORIES = [
  "Account / Login",
  "Playback",
  "Playlist / Library",
  "App Bug",
  "Downloads",
  "Report Content",
  "Other",
];
const ARTIST_SUPPORT_CATEGORIES = [
  "Artist Application",
  "Upload Problem",
  "Release Review",
  "Metadata Correction",
  "Artist Profile",
  "Copyright / Ownership",
  "Analytics",
  "Other",
];
const ADMIN_ROLES = {
  SUPER_ADMIN: "super_admin",
  CONTENT_ADMIN: "content_admin",
  MODERATOR: "moderator",
  SUPPORT_ADMIN: "support_admin",
};
const ADMIN_ROLE_PERMISSIONS = {
  [ADMIN_ROLES.SUPER_ADMIN]: ["*"],
  [ADMIN_ROLES.CONTENT_ADMIN]: [
    "applications",
    "artists",
    "catalog",
    "discovery",
    "genres",
    "releases",
  ],
  [ADMIN_ROLES.MODERATOR]: ["reports", "users", "artists", "catalog"],
  [ADMIN_ROLES.SUPPORT_ADMIN]: ["support:view", "support:reply", "support:note", "support:update"],
};
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
  storage: USE_SUPABASE_PERSISTENCE
    ? multer.memoryStorage()
    : multer.diskStorage({
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

    if (file.fieldname === "support_attachment") {
      if (
        SUPPORT_ATTACHMENT_EXTENSIONS.has(extension) ||
        SUPPORT_ATTACHMENT_MIME_TYPES.has(mime) ||
        SUPPORT_ATTACHMENT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
      ) {
        return cb(null, true);
      }
      return cb(new Error("Upload a valid support attachment."));
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

async function uploadUrlFor(file) {
  if (!file) return "";
  if (USE_SUPABASE_PERSISTENCE) {
    return supabasePersistence.uploadFile(file);
  }
  const relative = path
    .relative(UPLOADS_DIR, file.path)
    .split(path.sep)
    .join("/");
  return `/uploads/${relative}`;
}

async function ensureDb() {
  if (USE_SUPABASE_PERSISTENCE) {
    supabasePersistence.assertConfigured();
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch (error) {
    await saveDb(emptyDb());
  }
}

const writeBaselines = new WeakMap();

async function loadDb() {
  if (USE_SUPABASE_PERSISTENCE) {
    const raw = await supabasePersistence.loadDb();
    const stored = structuredClone(raw);
    const persistedGenres = raw.genres;
    const db = normalizeDb(raw);
    // JSON seed genres are not database records and can reuse persisted IDs.
    if (Array.isArray(persistedGenres)) db.genres = persistedGenres;
    writeBaselines.set(db, {before:structuredClone(db), stored});
    return db;
  }
  await ensureDb();
  const raw = await fs.readFile(DB_PATH, "utf8");
  return normalizeDb(JSON.parse(raw));
}

async function saveDb(db) {
  if (USE_SUPABASE_PERSISTENCE) {
    const baseline = writeBaselines.get(db);
    if (!baseline) throw new Error("Supabase writes require a tracked baseline.");
    await supabasePersistence.saveChanges(baseline.before, db, baseline.stored);
    // This request must re-read before making a second independent mutation.
    writeBaselines.delete(db);
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

function nowIso() {
  return new Date().toISOString();
}

function defaultGenres() {
  const timestamp = nowIso();
  return GENRE_OPTIONS.map((name, index) => ({
    id: index + 1,
    name,
    active: true,
    position: index + 1,
    created_at: timestamp,
    updated_at: timestamp,
  }));
}

function defaultPlatformSettings() {
  return {
    registration_enabled: true,
    artist_applications_enabled: true,
    music_uploads_enabled: true,
    maintenance_mode: false,
    maintenance_message: "TesoHub Music is temporarily under maintenance.",
    max_audio_upload_mb: 80,
    max_artwork_upload_mb: 10,
    supported_audio_formats: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "webm"],
    minimum_supported_app_version: "",
    app_announcement: "",
    feature_flags: {
      artist_studio_enabled: true,
      offline_downloads_enabled: false,
      playlists_enabled: true,
      registrations_enabled: true,
      sharing_enabled: true,
    },
    updated_at: null,
    updated_by: "",
  };
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
    reports: [],
    genres: defaultGenres(),
    adminAuditLogs: [],
    platformSettings: defaultPlatformSettings(),
    nextIds: {
      adminAuditLog: 1,
      artist: 1,
      artistApplication: 1,
      genre: GENRE_OPTIONS.length + 1,
      listener: 1,
      playlist: 1,
      report: 1,
      release: 1,
      song: 1,
    },
  };
}

function normalizePlatformSettings(value = {}) {
  const defaults = defaultPlatformSettings();
  const rawFeatureFlags =
    value && typeof value.feature_flags === "object" && !Array.isArray(value.feature_flags)
      ? value.feature_flags
      : {};
  const settings = {
    ...defaults,
    ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
    feature_flags: {
      ...defaults.feature_flags,
      ...rawFeatureFlags,
    },
  };

  settings.registration_enabled = Boolean(settings.registration_enabled);
  settings.artist_applications_enabled = Boolean(settings.artist_applications_enabled);
  settings.music_uploads_enabled = Boolean(settings.music_uploads_enabled);
  settings.maintenance_mode = Boolean(settings.maintenance_mode);
  settings.max_audio_upload_mb = Math.max(1, Number(settings.max_audio_upload_mb || defaults.max_audio_upload_mb));
  settings.max_artwork_upload_mb = Math.max(1, Number(settings.max_artwork_upload_mb || defaults.max_artwork_upload_mb));
  settings.supported_audio_formats = Array.isArray(settings.supported_audio_formats)
    ? settings.supported_audio_formats
        .map((format) => cleanText(format).replace(/^\./, "").toLowerCase())
        .filter(Boolean)
    : defaults.supported_audio_formats;
  if (settings.supported_audio_formats.length === 0) {
    settings.supported_audio_formats = defaults.supported_audio_formats;
  }
  settings.feature_flags = Object.fromEntries(
    Object.entries(settings.feature_flags).map(([key, enabled]) => [key, Boolean(enabled)]),
  );
  settings.feature_flags.registrations_enabled =
    settings.registration_enabled && settings.feature_flags.registrations_enabled !== false;
  return settings;
}

function normalizeGenres(items) {
  const timestamp = nowIso();
  const seenNames = new Set();
  const normalized = Array.isArray(items)
    ? items
        .map((genre, index) => {
          const name = cleanText(typeof genre === "string" ? genre : genre?.name);
          if (!name) return null;
          const key = name.toLowerCase();
          if (seenNames.has(key)) return null;
          seenNames.add(key);
          return {
            id: Number(genre?.id || index + 1),
            name,
            active: genre?.active !== false,
            position: Number(genre?.position || index + 1),
            created_at: genre?.created_at || timestamp,
            updated_at: genre?.updated_at || genre?.created_at || timestamp,
          };
        })
        .filter(Boolean)
    : [];

  for (const defaultGenre of defaultGenres()) {
    const key = defaultGenre.name.toLowerCase();
    if (!seenNames.has(key)) {
      normalized.push(defaultGenre);
      seenNames.add(key);
    }
  }

  return normalized.sort((first, second) => {
    if (Number(first.position || 0) !== Number(second.position || 0)) {
      return Number(first.position || 0) - Number(second.position || 0);
    }
    return first.name.localeCompare(second.name);
  });
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
  db.reports = Array.isArray(db.reports) ? db.reports : [];
  db.adminAuditLogs = Array.isArray(db.adminAuditLogs) ? db.adminAuditLogs : [];
  db.genres = normalizeGenres(db.genres);
  db.platformSettings = normalizePlatformSettings(db.platformSettings);
  db.artists = db.artists.map((artist) => ({
    ...artist,
    status: ARTIST_STATUSES.has(artist.status) ? artist.status : "active",
    updated_at: artist.updated_at || artist.created_at || null,
  }));
  db.songs = db.songs.map((song) => ({
    ...song,
    status: SONG_STATUSES.has(song.status) ? song.status : "published",
    updated_at: song.updated_at || song.created_at || null,
  }));
  db.listeners = db.listeners.map((listener) => ({
    ...listener,
    role: LISTENER_ROLES.has(listener.role) ? listener.role : "listener",
    status: LISTENER_STATUSES.has(listener.status) ? listener.status : "active",
    plan: listener.plan || "free",
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
  db.reports = db.reports.map((report) => ({
    ...report,
    id: Number(report.id || 0),
    reporter: report.reporter ? Number(report.reporter) : null,
    target_id: report.target_id ? Number(report.target_id) : null,
    target_type: cleanText(report.target_type || "content"),
    reason: cleanText(report.reason),
    status: REPORT_STATUSES.has(report.status) ? report.status : "open",
    created_at: report.created_at || nowIso(),
    updated_at: report.updated_at || report.created_at || nowIso(),
  }));
  db.adminAuditLogs = db.adminAuditLogs.map((entry) => ({
    ...entry,
    id: Number(entry.id || 0),
    admin_user: entry.admin_user || "admin",
    admin_role: entry.admin_role || ADMIN_ROLES.SUPER_ADMIN,
    action: entry.action || "admin_action",
    target_type: entry.target_type || "system",
    target_id: entry.target_id ?? null,
    details: entry.details && typeof entry.details === "object" ? entry.details : {},
    reason: entry.reason || "",
    created_at: entry.created_at || nowIso(),
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
  db.nextIds.genre = Math.max(
    Number(db.nextIds.genre || 1),
    maxNextId(db.genres),
  );
  db.nextIds.report = Math.max(
    Number(db.nextIds.report || 1),
    maxNextId(db.reports),
  );
  db.nextIds.adminAuditLog = Math.max(
    Number(db.nextIds.adminAuditLog || 1),
    maxNextId(db.adminAuditLogs),
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

function platformSettingsFor(db) {
  db.platformSettings = normalizePlatformSettings(db.platformSettings);
  return db.platformSettings;
}

function featureFlagsFor(db) {
  return platformSettingsFor(db).feature_flags;
}

function genreOptionsFor(db, { activeOnly = true } = {}) {
  const genres = normalizeGenres(db?.genres);
  return genres
    .filter((genre) => !activeOnly || genre.active)
    .sort((first, second) => {
      if (Number(first.position || 0) !== Number(second.position || 0)) {
        return Number(first.position || 0) - Number(second.position || 0);
      }
      return first.name.localeCompare(second.name);
    })
    .map((genre) => genre.name);
}

function isPublicArtist(artist) {
  return artist && artist.status !== "removed";
}

function isPublicSong(db, song) {
  if (!song || song.status !== "published") return false;
  const artist = db.artists.find((item) => Number(item.id) === Number(song.artist));
  const source = song.source_release_id && db.releases.find((item) => Number(item.id) === Number(song.source_release_id));
  return artist?.status === "active" && (!song.source_release_id ||
    (source?.status === "published" && Number(source.public_song) === Number(song.id)));
}

function publicSongsFor(db) {
  return db.songs.filter((song) => isPublicSong(db, song));
}

function publicArtistsFor(db) {
  return db.artists.filter(isPublicArtist);
}

function clampNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function publicPlatformStatus(db) {
  const settings = platformSettingsFor(db);
  const featureFlags = featureFlagsFor(db);
  return {
    app_announcement: settings.app_announcement || "",
    artist_applications_enabled: Boolean(settings.artist_applications_enabled),
    feature_flags: featureFlags,
    maintenance_message:
      settings.maintenance_message || "TesoHub Music is temporarily under maintenance.",
    maintenance_mode: Boolean(settings.maintenance_mode),
    minimum_supported_app_version: settings.minimum_supported_app_version || "",
    music_uploads_enabled: Boolean(settings.music_uploads_enabled),
    registration_enabled: Boolean(
      settings.registration_enabled && featureFlags.registrations_enabled,
    ),
  };
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

function trackProductEvent(eventName, payload = {}) {
  console.log("[TesoHub Music Event]", {
    event: eventName,
    ...payload,
    occurred_at: new Date().toISOString(),
  });
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
    audio_file: audioResponseUrl(req, "song", song, absoluteUrl),
    cover_image: absoluteUrl(req, song.cover_image),
    genre: song.genre || "",
    genre_note: song.genre_note || "",
    lyrics: song.lyrics || "",
    like_count: likeCount(db, song.id),
    play_count: Number(song.play_count || 0),
    release_date: song.release_date || null,
    is_featured: Boolean(song.is_featured),
    status: song.status || "published",
    created_at: song.created_at,
    updated_at: song.updated_at || null,
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
    published_song_count: songs.filter((song) => isPublicSong(db, song)).length,
    status: artist.status || "active",
    stream_count: songs.reduce((total, song) => total + numberOrZero(song.play_count), 0),
    created_at: artist.created_at,
    updated_at: artist.updated_at || null,
  };

  if (includeSongs) {
    serialized.songs = songs
      .filter((song) => isPublicSong(db, song))
      .map((song) => serializeSong(db, req, song));
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
        return song && isPublicSong(db, song)
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
    audio_file: audioResponseUrl(req, "release", release, absoluteUrl),
    cover_image: absoluteUrl(req, release.cover_image),
    status: release.status || "draft",
    rejection_reason: release.rejection_reason || "",
    review_reason: release.review_reason || "",
    last_review_reason: [...db.adminAuditLogs].filter((row) => row.target_type === "release" && Number(row.target_id) === Number(release.id) &&
      ["reject_release", "request_release_changes"].includes(row.action))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || Number(b.id) - Number(a.id))[0]?.details?.reason || "",
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
    status: "published",
    source_release_id: release.id,
    created_at: now,
    updated_at: now,
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
    if (release.status === "scheduled" && release.approved_at && !release.public_song &&
      !validateReleaseForSubmit(release) && releaseLinkageValid(db, release) && !isFutureReleaseDate(release.release_date)) {
      changed = publishRelease(db, release) || changed;
    }
  }
  return changed;
}

async function loadDbWithPublishedReleases() {
  // Compatibility helper: reads never publish. Publication belongs to the worker.
  return loadDb();
}

function releaseLinkageValid(db, release) {
  const artist = db.artists.find((row) => Number(row.id) === Number(release.artist));
  const listener = db.listeners.find((row) => Number(row.id) === Number(release.listener));
  return Boolean(artist && listener && artist.status === "active" && listener.status === "active" &&
    listener.role === "artist" && Number(artist.owner_listener) === Number(listener.id) &&
    Number(listener.artist_id) === Number(artist.id));
}

function serializeReleaseReview(db, req, release) {
  const data = serializeRelease(db, req, release);
  // Operational linkage only; the review does not require contact details.
  data.listener = data.listener ? {id:data.listener.id, name:data.listener.name} : null;
  data.linkage_valid = releaseLinkageValid(db, release);
  data.publication = releasePublicationInfo(db, release);
  data.history = db.adminAuditLogs.filter((row) => row.target_type === "release" &&
    Number(row.target_id) === Number(release.id) &&
    ["approve_release", "reject_release", "request_release_changes", "publish_release"].includes(row.action))
    .map((row) => ({action:row.action, at:row.created_at, admin_user:row.admin_user,
      admin_role:row.admin_role, reason:row.details?.reason || row.details?.review_reason || ""}));
  return data;
}

function releasePublicationInfo(db, release) {
  const candidate = ["approved", "scheduled"].includes(release.status);
  const date = cleanText(release.release_date);
  const parsed = new Date(`${date}T00:00:00Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  const timing = !validDate ? "unscheduled" : isFutureReleaseDate(date) ? "future" : "due";
  let reason = "";
  if (!candidate) reason = "Not approved or scheduled.";
  else if (release.status !== "scheduled") reason = "Approved legacy state needs review; only scheduled releases auto-publish.";
  else if (!release.approved_at) reason = "Approval record is missing.";
  else if (!releaseLinkageValid(db, release)) reason = "Active artist/account ownership does not match.";
  else if (release.public_song || db.songs.some((song) => Number(song.source_release_id) === Number(release.id))) reason = "A linked song already exists; inspect linkage before publication.";
  else reason = validateReleaseForSubmit(release);
  if (!reason && timing !== "due") reason = "Scheduled date has not arrived (UTC).";
  return {candidate, timing, eligible:candidate && !reason, reason};
}

function releaseReviewIsCurrent(req, release) {
  return !req.body?.expected_updated_at || req.body.expected_updated_at === release.updated_at;
}

function makeHubSearchDocuments(db, req) {
  const artistDocuments = publicArtistsFor(db).map((artist) => {
    const songs = publicSongsFor(db).filter(
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

  const songDocuments = publicSongsFor(db).map((song) => {
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

function configuredAdminRole() {
  const role = process.env.ADMIN_ROLE;
  // Require an explicit, exact role; never infer privileges from invalid config.
  return typeof role === "string" && Object.prototype.hasOwnProperty.call(ADMIN_ROLE_PERMISSIONS, role)
    ? role : null;
}

function publicAdminUser() {
  const role = configuredAdminRole();
  return {
    username: ADMIN_USERNAME,
    role,
    permissions: ADMIN_ROLE_PERMISSIONS[role] || [],
  };
}

function adminCan(adminUser, permission) {
  const role = adminUser?.role;
  const permissions = typeof role === "string" && Object.prototype.hasOwnProperty.call(ADMIN_ROLE_PERMISSIONS, role)
    ? ADMIN_ROLE_PERMISSIONS[role] : [];
  return permissions.includes("*") || permissions.includes(permission);
}

function requireAdminPermission(...permissions) {
  return (req, res, next) => {
    req.adminUser = req.adminIdentity;
    if (!req.adminUser || !Object.prototype.hasOwnProperty.call(ADMIN_ROLE_PERMISSIONS, req.adminUser.role)) {
      return res.status(403).json({ detail: "Forbidden" });
    }
    if (
      permissions.length > 0 &&
      !permissions.some((permission) => adminCan(req.adminUser, permission))
    ) {
      return res.status(403).json({ detail: "Forbidden" });
    }
    next();
  };
}

const requireAdmin = requireAdminPermission();
const requireSuperAdmin = requireAdminPermission("*");
const adminAccounts = createAdminAccounts({getPool: () => {
  if (!USE_SUPABASE_PERSISTENCE) throw new Error("Individual Admin accounts require PostgreSQL.");
  return supabasePersistence.getAdminPool();
}, roles: ADMIN_ROLE_PERMISSIONS, breakGlass: {
  username: ADMIN_USERNAME, password: ADMIN_PASSWORD, token: ADMIN_TOKEN, role: configuredAdminRole,
}});
adminAccounts.install(app, requireAdmin, requireSuperAdmin);

function requirePermanentDeletePermission(req, res, next) {
  if (req.query?.confirm === "DELETE FOREVER") return requireSuperAdmin(req, res, next);
  next();
}

function allowFeaturedChange(req, res, current = false) {
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "is_featured") &&
      boolValue(req.body.is_featured) !== Boolean(current) && !adminCan(req.adminUser, "discovery")) {
    res.status(403).json({ detail: "Forbidden" });
    return false;
  }
  return true;
}

const migrationJobs = new Map();

const MIGRATION_CONFIRMATIONS = {
  migrate: "MIGRATE RENDER DATA TO SUPABASE",
  schema: "APPLY SUPABASE SCHEMA",
  validate: "VALIDATE SUPABASE MIGRATION",
};

function migrationScriptPath(filename) {
  return path.join(__dirname, "scripts", filename);
}

function migrationJobSnapshot(job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    exit_code: job.exitCode,
    signal: job.signal,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    logs: job.logs.slice(-120),
  };
}

function pruneMigrationJobs() {
  const jobs = [...migrationJobs.values()].sort((first, second) =>
    String(second.startedAt).localeCompare(String(first.startedAt)),
  );
  for (const job of jobs.slice(20)) {
    migrationJobs.delete(job.id);
  }
}

function appendMigrationLog(job, source, chunk) {
  const lines = String(chunk || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  for (const line of lines) {
    job.logs.push({
      at: nowIso(),
      source,
      text: line,
    });
  }
  if (job.logs.length > 400) {
    job.logs = job.logs.slice(-400);
  }
}

function startMigrationJob(kind, scriptName, env = {}) {
  const id = crypto.randomUUID();
  const job = {
    id,
    kind,
    status: "running",
    exitCode: null,
    signal: null,
    startedAt: nowIso(),
    finishedAt: null,
    logs: [],
  };
  migrationJobs.set(id, job);
  pruneMigrationJobs();

  const child = spawn(process.execPath, [migrationScriptPath(scriptName)], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...env,
    },
    windowsHide: true,
  });

  appendMigrationLog(job, "system", `Started ${kind} job ${id}.`);
  child.stdout.on("data", (chunk) => appendMigrationLog(job, "stdout", chunk));
  child.stderr.on("data", (chunk) => appendMigrationLog(job, "stderr", chunk));
  child.on("error", (error) => {
    job.status = "failed";
    job.finishedAt = nowIso();
    appendMigrationLog(job, "error", error.message);
  });
  child.on("close", (code, signal) => {
    job.exitCode = code;
    job.signal = signal;
    job.status = code === 0 ? "succeeded" : "failed";
    job.finishedAt = nowIso();
    appendMigrationLog(job, "system", `Finished with code ${code ?? "null"}.`);
  });

  return job;
}

function requireMigrationConfirmation(req, res, kind) {
  const expected = MIGRATION_CONFIRMATIONS[kind];
  if (req.body?.confirm !== expected) {
    res.status(400).json({
      detail: `Confirmation required. Send confirm: ${expected}`,
    });
    return false;
  }
  return true;
}

function appendAuditLog(db, req, action, targetType, targetId = null, details = {}) {
  const now = nowIso();
  db.adminAuditLogs = Array.isArray(db.adminAuditLogs) ? db.adminAuditLogs : [];
  db.nextIds = db.nextIds || {};
  db.nextIds.adminAuditLog = Number(db.nextIds.adminAuditLog || maxNextId(db.adminAuditLogs));
  db.adminAuditLogs.push({
    id: db.nextIds.adminAuditLog++,
    admin_user: req.adminUser?.username || ADMIN_USERNAME,
    admin_role: req.adminUser?.role || ADMIN_ROLES.SUPER_ADMIN,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    details: details && typeof details === "object" ? details : {},
    reason: cleanText(details?.reason),
    created_at: now,
  });
}

function requireListener(db, req, res) {
  const listener = findListenerByToken(db, req);
  if (!listener) {
    res.status(401).json({ detail: "Login required." });
    return null;
  }
  if (listener.status === "suspended") {
    res.status(403).json({ detail: "This account is suspended." });
    return null;
  }
  return listener;
}

async function supabaseListenerFromRequest(req) {
  if (!USE_SUPABASE_PERSISTENCE) return null;
  const token = getBearerToken(req);
  if (!token) return null;
  return supabasePersistence.listenerByTokenHash(hashToken(token));
}

async function requireSupabaseListener(req, res) {
  const listener = await supabaseListenerFromRequest(req);
  if (!listener) {
    res.status(401).json({ detail: "Login required." });
    return null;
  }
  if (listener.status === "suspended") {
    res.status(403).json({ detail: "This account is suspended." });
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
  if (artist.status === "suspended" || artist.status === "removed") {
    res.status(403).json({ detail: "This artist account is suspended." });
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

function cleanSupportCategory(value, listenerRole = "listener") {
  const cleanCategory = cleanText(value);
  const options =
    listenerRole === "artist" ? ARTIST_SUPPORT_CATEGORIES : LISTENER_SUPPORT_CATEGORIES;
  return (
    options.find(
      (category) => category.toLowerCase() === cleanCategory.toLowerCase(),
    ) || ""
  );
}

function createSupportReference() {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `SUP-${datePart}-${randomPart}`;
}

function supportHelpCenterPayload() {
  return {
    contact: {
      title: "Contact Support",
      message:
        "Send a ticket from your account so the TesoHub Music team can see your app profile and reply in one place.",
    },
    categories: {
      artist: ARTIST_SUPPORT_CATEGORIES,
      listener: LISTENER_SUPPORT_CATEGORIES,
    },
    articles: [
      {
        id: "become-an-artist",
        title: "How to become an artist",
        summary: "Open Profile, choose Become an Artist, and submit your details for review.",
      },
      {
        id: "upload-music",
        title: "How to upload music",
        summary:
          "Approved artists can use Artist Studio to create a release, attach audio and cover art, then submit it for review.",
      },
      {
        id: "release-under-review",
        title: "Why is my release under review?",
        summary:
          "New releases are checked by admins before publication to protect quality, metadata, and ownership.",
      },
      {
        id: "create-playlist",
        title: "How to create a playlist",
        summary: "Open Your Library, tap Create, enter a name, and add songs from the playlist screen.",
      },
      {
        id: "follow-artist",
        title: "How to follow an artist",
        summary:
          "Open an artist profile and tap Follow. Followed artists appear in your profile and library.",
      },
      {
        id: "song-unavailable",
        title: "Why is a song unavailable?",
        summary:
          "A song may be hidden during review, removed for policy reasons, or temporarily unavailable from storage.",
      },
      {
        id: "copyright-report",
        title: "How to report copyright infringement",
        summary:
          "Create a ticket with Copyright / Ownership or Report Content and include links or screenshots.",
      },
      {
        id: "delete-account",
        title: "How to delete my account",
        summary:
          "Create an Account / Login ticket and support will help verify and process the request.",
      },
      {
        id: "contact-support",
        title: "How to contact support",
        summary:
          "Use Submit Support Ticket from Help & Support so your conversation stays linked to your account.",
      },
    ],
  };
}

function supportAttachmentUrl(basePath, attachment, kind, ownerId) {
  if (!attachment?.path || !ownerId) return "";
  return `${basePath}/attachments/${encodeURIComponent(kind)}/${encodeURIComponent(ownerId)}/`;
}

function attachSupportUrls(ticket, basePath) {
  if (!ticket) return ticket;
  const ticketPath = `${basePath}/${encodeURIComponent(ticket.id)}`;
  const nextTicket = {
    ...ticket,
    attachment: ticket.attachment
      ? {
          ...ticket.attachment,
          url: supportAttachmentUrl(ticketPath, ticket.attachment, "ticket", ticket.id),
        }
      : null,
  };
  if (Array.isArray(nextTicket.messages)) {
    nextTicket.messages = nextTicket.messages.map((message) => ({
      ...message,
      attachment: message.attachment
        ? {
            ...message.attachment,
            url: supportAttachmentUrl(ticketPath, message.attachment, "message", message.id),
          }
        : null,
    }));
  }
  return nextTicket;
}

function supportTicketListPayload(tickets, basePath) {
  return tickets.map((ticket) => attachSupportUrls(ticket, basePath));
}

function supportFormPayload(req, listener) {
  const requesterRole = ["artist", "artist_pending"].includes(listener?.role)
    ? "artist"
    : "listener";
  const category = cleanSupportCategory(req.body?.category, requesterRole);
  const subject = cleanText(req.body?.subject);
  const message = cleanText(req.body?.message);
  const submittedPriority = cleanText(req.body?.priority).toLowerCase();

  return {
    category,
    message,
    priority: SUPPORT_TICKET_PRIORITIES.has(submittedPriority)
      ? submittedPriority
      : "normal",
    requesterRole,
    subject,
  };
}

function supportPayloadError(payload) {
  if (!payload.category) return "Choose a valid support category.";
  if (payload.subject.length < 3) return "Enter a support subject.";
  if (payload.message.length < 8) return "Describe the issue in your message.";
  return "";
}

function supportAttachmentError(file) {
  if (!file) return "";
  if (Number(file.size || 0) > MAX_SUPPORT_ATTACHMENT_BYTES) {
    return "Support attachments must be 8 MB or smaller.";
  }
  return "";
}

async function uploadSupportAttachmentIfPresent(file, reference) {
  if (!file) return null;
  if (!USE_SUPABASE_PERSISTENCE) {
    throw new Error("Support attachments require Supabase Storage.");
  }
  return supabasePersistence.uploadSupportAttachment(file, reference);
}

async function auditSupportAction(req, action, targetId, details = {}) {
  if (!USE_SUPABASE_PERSISTENCE) return;
  await supabasePersistence.recordAdminAuditLog({
    action,
    adminRole: req.adminUser?.role || ADMIN_ROLES.SUPER_ADMIN,
    adminUser: req.adminUser?.username || ADMIN_USERNAME,
    details,
    targetId,
    targetType: "support_ticket",
  });
}

function normalizeGenre(value, db = null) {
  const cleanGenre = cleanText(value);
  if (!cleanGenre) return "";

  const genreOptions = db ? genreOptionsFor(db) : GENRE_OPTIONS;
  const knownGenre = genreOptions.find(
    (genre) => genre.toLowerCase() === cleanGenre.toLowerCase(),
  );
  return knownGenre || "Other";
}

function genrePayload(req, db = null) {
  const submittedGenre = cleanText(req.body?.genre);
  const genre = normalizeGenre(submittedGenre, db);
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

function directSongResponse(req, song) {
  if (!song) return null;
  return {
    ...song,
    audio_file: audioResponseUrl(req, "song", song, absoluteUrl),
    cover_image: absoluteUrl(req, song.cover_image),
  };
}

function directArtistResponse(req, artist) {
  if (!artist) return null;
  return {
    ...artist,
    photo: absoluteUrl(req, artist.photo),
    ...(Array.isArray(artist.songs)
      ? { songs: artist.songs.map((song) => directSongResponse(req, song)) }
      : {}),
  };
}

function directPlaylistResponse(req, playlist) {
  if (!playlist) return null;
  return {
    ...playlist,
    artwork: absoluteUrl(req, playlist.artwork),
    ...(Array.isArray(playlist.songs)
      ? { songs: playlist.songs.map((song) => directSongResponse(req, song)) }
      : {}),
  };
}

function makeAuthTokenPayload(listener, token) {
  return { token, listener };
}

function newAuthSessionPayload(deviceId = "", deviceName = "") {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    deviceId: cleanText(deviceId),
    deviceName: cleanText(deviceName),
    sessionId: crypto.randomUUID(),
    token,
    tokenHash: hashToken(token),
  };
}

function applicationPayload(req, db = null) {
  const genreData = genrePayload(req, db);
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

function releasePayload(req, db = null) {
  const genreData = genrePayload(req, db);
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
  const date = new Date(`${release.release_date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== release.release_date) {
    return "Choose a valid release date.";
  }
  if (!release.rights_confirmed) {
    return "Confirm that you own or control the rights.";
  }
  return "";
}

function bytesFromMb(value) {
  return Math.max(1, Number(value || 1)) * 1024 * 1024;
}

function fileExtension(file) {
  return path.extname(file?.originalname || "").replace(/^\./, "").toLowerCase();
}

function validateUploadSettings(db, files = {}) {
  const settings = platformSettingsFor(db);
  const audioFiles = [
    ...(files.audio_upload || []),
    ...(files.audio_file || []),
  ].filter(Boolean);
  const artworkFiles = [
    ...(files.cover_upload || []),
    ...(files.photo_file || []),
  ].filter(Boolean);
  const maxAudioBytes = bytesFromMb(settings.max_audio_upload_mb);
  const maxArtworkBytes = bytesFromMb(settings.max_artwork_upload_mb);
  const supportedFormats = new Set(
    (settings.supported_audio_formats || []).map((format) =>
      cleanText(format).replace(/^\./, "").toLowerCase(),
    ),
  );

  for (const file of audioFiles) {
    const extension = fileExtension(file);
    if (file.size > maxAudioBytes) {
      return `Audio file is larger than ${settings.max_audio_upload_mb} MB.`;
    }
    if (extension && supportedFormats.size > 0 && !supportedFormats.has(extension)) {
      return `Audio format .${extension} is not enabled.`;
    }
  }

  for (const file of artworkFiles) {
    if (file.size > maxArtworkBytes) {
      return `Image file is larger than ${settings.max_artwork_upload_mb} MB.`;
    }
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
  release.approved_at = null;
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
    status: "active",
    owner_listener: application.listener,
    source_application_id: application.id,
    created_at: now,
    updated_at: now,
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

// Preserve artist/playlist links previously shared on the API origin.
app.get(["/artist/:id", "/playlist/:id"], (req, res) => {
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) return res.sendStatus(404);
  res.set("Cache-Control", "no-store");
  return res.redirect(302, `${PUBLIC_MUSIC_WEB_URL.replace(/\/+$/, "")}${req.path}`);
});

app.get("/song/:id", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) {
    return res.status(404).type("html").send(renderUnavailableSongPage());
  }
  try {
    let song;
    if (USE_SUPABASE_PERSISTENCE) {
      song = await supabasePersistence.getPublicSong(req.params.id);
    } else {
      const db = await loadDbWithPublishedReleases();
      const item = db.songs.find((entry) => Number(entry.id) === Number(req.params.id));
      song = isPublicSong(db, item) ? serializeSong(db, req, item) : null;
    }
    if (!isShareableSong(song)) {
      return res.status(404).type("html").send(renderUnavailableSongPage());
    }
    trackProductEvent("shared_song_opened", { available: true, song_id: song.id });
    return res.type("html").send(renderPublicSongPage(song, {
      shareBaseUrl: publicShareBaseUrl(req),
      webBaseUrl: PUBLIC_MUSIC_WEB_URL,
      assetBaseUrl: PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`,
      androidDownloadUrl: process.env.ANDROID_DOWNLOAD_URL || process.env.ANDROID_STORE_URL || "",
    }));
  } catch (error) {
    console.error("Song share page unavailable:", error.message);
    return res.status(503).type("html").send(renderUnavailableSongPage());
  }
});

app.get("/api/platform-status/", async (req, res) => {
  if (USE_SUPABASE_PERSISTENCE) {
    return res.json(publicPlatformStatus({
      platformSettings: await supabasePersistence.platformSettings(),
    }));
  }

  const db = await loadDb();
  res.json(publicPlatformStatus(db));
});

app.post("/api/auth/register/", async (req, res) => {
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

  if (USE_SUPABASE_PERSISTENCE) {
    const settings = normalizePlatformSettings(await supabasePersistence.platformSettings());
    if (!settings.registration_enabled || !settings.feature_flags.registrations_enabled) {
      return res.status(403).json({ detail: "New account registration is temporarily disabled." });
    }
    if (await supabasePersistence.loginExists({ email, phone })) {
      return res.status(409).json({ detail: "An account already exists." });
    }

    const session = newAuthSessionPayload(deviceId, deviceName);
    const listener = await supabasePersistence.createListenerAccount({
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      email,
      name,
      passwordHash: hashPassword(password),
      phone,
      sessionId: session.sessionId,
      tokenHash: session.tokenHash,
    });
    return res.status(201).json(makeAuthTokenPayload(listener, session.token));
  }

  const db = await loadDb();
  const settings = platformSettingsFor(db);
  if (!settings.registration_enabled || !featureFlagsFor(db).registrations_enabled) {
    return res.status(403).json({ detail: "New account registration is temporarily disabled." });
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
  const identifier = cleanText(req.body?.identifier || req.body?.email || req.body?.phone);
  const password = String(req.body?.password || "");
  const deviceId = cleanText(req.body?.device_id);
  const deviceName = cleanText(req.body?.device_name);

  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await supabasePersistence.listenerByIdentifier({
      email: normalizeEmail(identifier),
      phone: normalizePhone(identifier),
    });

    if (!listener || !verifyPassword(password, listener.password_hash)) {
      return res.status(401).json({ detail: "Invalid login details." });
    }
    if (listener.status === "suspended") {
      return res.status(403).json({ detail: "This account is suspended." });
    }

    const session = newAuthSessionPayload(deviceId, deviceName);
    const profile = await supabasePersistence.createAuthSession({
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      listenerId: listener.id,
      sessionId: session.sessionId,
      tokenHash: session.tokenHash,
    });
    return res.json(makeAuthTokenPayload(profile, session.token));
  }

  const db = await loadDb();
  const listener = findListenerByIdentifier(db, identifier);

  if (!listener || !verifyPassword(password, listener.password_hash)) {
    return res.status(401).json({ detail: "Invalid login details." });
  }
  if (listener.status === "suspended") {
    return res.status(403).json({ detail: "This account is suspended." });
  }

  attachDeviceEngagement(db, listener, deviceId);
  const token = createAuthSession(db, listener, deviceId, deviceName);
  await saveDb(db);
  res.json(authResponse(db, listener, token));
});

app.get("/api/auth/me/", async (req, res) => {
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;
    return res.json({
      listener: await supabasePersistence.listenerProfile(listener.id),
    });
  }

  const db = await loadDb();
  const listener = requireListener(db, req, res);
  if (!listener) return;
  await saveDb(db);
  res.json({ listener: serializeListener(db, listener) });
});

app.put("/api/auth/me/", async (req, res) => {
  const db = await loadDb();
  const listener = requireListener(db, req, res);
  if (!listener) return;

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
    if (!platformSettingsFor(db).artist_applications_enabled) {
      return res.status(403).json({
        detail: "Artist applications are temporarily unavailable.",
      });
    }

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

    const payload = applicationPayload(req, db);
    const uploadError = validateUploadSettings(db, { photo_file: req.file ? [req.file] : [] });
    if (uploadError) {
      return res.status(400).json({ detail: uploadError });
    }

    const validationError = validateArtistApplication(payload, Boolean(req.file));
    if (validationError) {
      return res.status(400).json({ detail: validationError });
    }

    const now = new Date().toISOString();
    const application = {
      id: db.nextIds.artistApplication++,
      listener: listener.id,
      ...payload,
      photo: await uploadUrlFor(req.file),
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
  res.set("Cache-Control", "no-store");
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
  res.set("Cache-Control", "no-store");
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
    if (!featureFlagsFor(db).artist_studio_enabled || !platformSettingsFor(db).music_uploads_enabled) {
      return res.status(403).json({ detail: "Music uploads are temporarily disabled." });
    }
    const uploadError = validateUploadSettings(db, req.files);
    if (uploadError) {
      return res.status(400).json({ detail: uploadError });
    }

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
      audio_file: await uploadUrlFor(req.files?.audio_upload?.[0]),
      cover_image: await uploadUrlFor(req.files?.cover_upload?.[0]),
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
    assignReleasePayload(release, releasePayload(req, db));
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
    if (!featureFlagsFor(db).artist_studio_enabled || !platformSettingsFor(db).music_uploads_enabled) {
      return res.status(403).json({ detail: "Music uploads are temporarily disabled." });
    }
    const uploadError = validateUploadSettings(db, req.files);
    if (uploadError) {
      return res.status(400).json({ detail: uploadError });
    }

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
    if (Number(release.listener) !== Number(account.listener.id)) return res.status(404).json({detail:"Release not found."});
    if (!releaseReviewIsCurrent(req, release)) return res.status(409).json({detail:"This release changed. Reopen the editor before saving."});

    assignReleasePayload(release, releasePayload(req, db));
    release.release_type = "Single";
    release.audio_file =
      (await uploadUrlFor(req.files?.audio_upload?.[0])) || release.audio_file;
    release.cover_image =
      (await uploadUrlFor(req.files?.cover_upload?.[0])) || release.cover_image;
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
  if (!featureFlagsFor(db).artist_studio_enabled || !platformSettingsFor(db).music_uploads_enabled) {
    return res.status(403).json({ detail: "Music uploads are temporarily disabled." });
  }

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
  if (Number(release.listener) !== Number(account.listener.id)) return res.status(404).json({detail:"Release not found."});

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
    if (!featureFlagsFor(db).artist_studio_enabled) {
      return res.status(403).json({ detail: "Artist Studio is temporarily disabled." });
    }
    const uploadError = validateUploadSettings(db, { photo_file: req.file ? [req.file] : [] });
    if (uploadError) {
      return res.status(400).json({ detail: uploadError });
    }

    account.artist.bio = cleanText(req.body?.bio) || account.artist.bio;
    account.artist.category =
      cleanText(req.body?.category) || account.artist.category;
    account.artist.location =
      cleanText(req.body?.location) || account.artist.location;
    account.artist.photo = (await uploadUrlFor(req.file)) || account.artist.photo;
    account.artist.updated_at = new Date().toISOString();
    await saveDb(db);
    res.json(serializeArtist(db, req, account.artist));
  },
);

app.get("/api/artists/", async (req, res) => {
  const discovery = discoveryOptions(req.query);
  const category = String(req.query.category || "").toLowerCase();
  const search = String(req.query.search || "").toLowerCase();
  if (USE_SUPABASE_PERSISTENCE) {
    const artists = await supabasePersistence.listPublicArtists({ category, search, ...discovery });
    return res.json(artists.map((artist) => directArtistResponse(req, artist)));
  }

  const db = await loadDbWithPublishedReleases();
  const artists = sortArtists(publicArtistsFor(db)).filter((artist) => {
    const categoryMatches =
      !category || artist.category.toLowerCase() === category;
    const searchMatches = !search || artist.name.toLowerCase().includes(search);
    return categoryMatches && searchMatches;
  });
  res.json(selectDiscovery(artists, discovery, "artist").map((artist) => serializeArtist(db, req, artist)));
});

app.get("/api/artists/:id/", async (req, res) => {
  if (USE_SUPABASE_PERSISTENCE) {
    const artist = await supabasePersistence.getPublicArtist(req.params.id, {
      includeSongs: true,
    });
    if (!artist) return res.status(404).json({ detail: "Artist not found." });
    return res.json(directArtistResponse(req, artist));
  }

  const db = await loadDbWithPublishedReleases();
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!artist || !isPublicArtist(artist)) {
    return res.status(404).json({ detail: "Artist not found." });
  }
  res.json(serializeArtist(db, req, artist, true));
});

app.get("/api/songs/", async (req, res) => {
  const discovery = discoveryOptions(req.query);
  const category = String(req.query.category || "").toLowerCase();
  const search = String(req.query.search || "").toLowerCase();
  if (USE_SUPABASE_PERSISTENCE) {
    const songs = await supabasePersistence.listPublicSongs({ category, search, ...discovery });
    return res.json(songs.map((song) => directSongResponse(req, song)));
  }

  const db = await loadDbWithPublishedReleases();
  const songs = sortSongs(publicSongsFor(db)).filter((song) => {
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
  res.json(selectDiscovery(songs, discovery).map((song) => serializeSong(db, req, song)));
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
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) {
    return res.status(404).json({ detail: "Song not found." });
  }
  if (USE_SUPABASE_PERSISTENCE) {
    const song = await supabasePersistence.getPublicSong(req.params.id);
    if (!isShareableSong(song)) return res.status(404).json({ detail: "Song not found." });
    return res.json(directSongResponse(req, song));
  }

  const db = await loadDbWithPublishedReleases();
  const song = db.songs.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!isShareableSong(song) || !isPublicSong(db, song)) {
    return res.status(404).json({ detail: "Song not found." });
  }
  res.json(serializeSong(db, req, song));
});

app.post("/api/songs/:id/play/", async (req, res) => {
  try {
    if (USE_SUPABASE_PERSISTENCE) {
      const song = await supabasePersistence.recordSongPlay(req.params.id);
      if (!song) return res.status(404).json({ detail: "Song not found." });
      return res.json({id:song.id, play_count:song.play_count, song:directSongResponse(req, song)});
    }
    const db = await loadDbWithPublishedReleases();
    const song = db.songs.find(
      (item) => Number(item.id) === Number(req.params.id),
    );

    if (!song || !isPublicSong(db, song)) {
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
    sortArtists(publicArtistsFor(db).filter((artist) => artist.is_featured)).map(
      (artist) => serializeArtist(db, req, artist),
    ),
  );
});

app.get("/api/featured-songs/", async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  res.json(
    sortSongs(publicSongsFor(db).filter((song) => song.is_featured)).map((song) =>
      serializeSong(db, req, song),
    ),
  );
});

app.get("/api/genres/", async (req, res) => {
  if (USE_SUPABASE_PERSISTENCE) return res.json(await supabasePersistence.listPublicGenres());
  const db = await loadDb();
  res.json(genreOptionsFor(db));
});

app.get("/api/playlists/", async (req, res) => {
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;
    const playlists = await supabasePersistence.listPlaylists(listener.id);
    return res.json(playlists.map((playlist) => directPlaylistResponse(req, playlist)));
  }

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
  const name = cleanText(req.body?.name);
  if (name.length < 1) {
    return res.status(400).json({ detail: "Enter a playlist name." });
  }

  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;
    const playlist = await supabasePersistence.createPlaylist({
      artwork: cleanText(req.body?.artwork),
      description: cleanText(req.body?.description),
      listenerId: listener.id,
      name,
    });
    return res.status(201).json(directPlaylistResponse(req, playlist));
  }

  const db = await loadDb();
  const listener = requireListener(db, req, res);
  if (!listener) return;

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
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;
    const playlist = await supabasePersistence.getPlaylist(listener.id, req.params.id);
    if (!playlist) return res.status(404).json({ detail: "Playlist not found." });
    return res.json(directPlaylistResponse(req, playlist));
  }

  const db = await loadDbWithPublishedReleases();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const playlist = findOwnedPlaylist(db, listener, req.params.id);
  if (!playlist) return res.status(404).json({ detail: "Playlist not found." });

  res.json(serializePlaylist(db, req, playlist, true));
});

app.put("/api/playlists/:id/", async (req, res) => {
  const nextName = cleanText(req.body?.name);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "name") && nextName.length < 1) {
    return res.status(400).json({ detail: "Enter a playlist name." });
  }

  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;
    const playlist = await supabasePersistence.updatePlaylist({
      artwork: Object.prototype.hasOwnProperty.call(req.body || {}, "artwork")
        ? cleanText(req.body?.artwork)
        : undefined,
      description: Object.prototype.hasOwnProperty.call(req.body || {}, "description")
        ? cleanText(req.body?.description)
        : undefined,
      listenerId: listener.id,
      name: nextName || undefined,
      playlistId: req.params.id,
    });
    if (!playlist) return res.status(404).json({ detail: "Playlist not found." });
    return res.json(directPlaylistResponse(req, playlist));
  }

  const db = await loadDb();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const playlist = findOwnedPlaylist(db, listener, req.params.id);
  if (!playlist) return res.status(404).json({ detail: "Playlist not found." });

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
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;
    const deleted = await supabasePersistence.deletePlaylist(listener.id, req.params.id);
    if (!deleted) return res.status(404).json({ detail: "Playlist not found." });
    return res.json({ deleted: true });
  }

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
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;
    const result = await supabasePersistence.addSongToPlaylist({
      listenerId: listener.id,
      playlistId: req.params.id,
      songId: Number(req.body?.song || req.body?.song_id),
    });
    if (result?.notFound === "playlist") {
      return res.status(404).json({ detail: "Playlist not found." });
    }
    if (result?.notFound === "song") {
      return res.status(404).json({ detail: "Song not found." });
    }
    return res.status(result.added ? 201 : 200).json({
      ...result,
      playlist: directPlaylistResponse(req, result.playlist),
    });
  }

  const db = await loadDbWithPublishedReleases();
  const listener = requireListener(db, req, res);
  if (!listener) return;

  const playlist = findOwnedPlaylist(db, listener, req.params.id);
  if (!playlist) return res.status(404).json({ detail: "Playlist not found." });

  const songId = Number(req.body?.song || req.body?.song_id);
  const song = db.songs.find((item) => Number(item.id) === songId);
  if (!song || !isPublicSong(db, song)) {
    return res.status(404).json({ detail: "Song not found." });
  }

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
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;
    const result = await supabasePersistence.removeSongFromPlaylist({
      listenerId: listener.id,
      playlistId: req.params.id,
      songId: req.params.songId,
    });
    if (!result) return res.status(404).json({ detail: "Playlist not found." });
    return res.json({
      removed: result.removed,
      playlist: directPlaylistResponse(req, result.playlist),
    });
  }

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
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await supabaseListenerFromRequest(req);
    const deviceId = getDeviceId(req);
    if (!deviceId && !listener)
      return res.status(400).json({ detail: "device_id or login is required." });
    const result = await supabasePersistence.likeSong({
      deviceId,
      listenerId: listener?.id || null,
      songId: Number(req.params.id),
    });
    if (result.notFound) return res.status(404).json({ detail: "Song not found." });
    return res.json(result);
  }

  const db = await loadDb();
  const song = db.songs.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  const listener = findListenerByToken(db, req);
  const deviceId = getDeviceId(req);
  if (!song || !isPublicSong(db, song)) {
    return res.status(404).json({ detail: "Song not found." });
  }
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
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await supabaseListenerFromRequest(req);
    const deviceId = getDeviceId(req);
    if (!deviceId && !listener)
      return res.status(400).json({ detail: "device_id or login is required." });
    const result = await supabasePersistence.unlikeSong({
      deviceId,
      listenerId: listener?.id || null,
      songId: Number(req.params.id),
    });
    if (result.notFound) return res.status(404).json({ detail: "Song not found." });
    return res.json(result);
  }

  const db = await loadDb();
  const song = db.songs.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  const listener = findListenerByToken(db, req);
  const deviceId = getDeviceId(req);
  if (!song || !isPublicSong(db, song)) {
    return res.status(404).json({ detail: "Song not found." });
  }
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
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await supabaseListenerFromRequest(req);
    const deviceId = getDeviceId(req);
    if (!deviceId && !listener)
      return res.status(400).json({ detail: "device_id or login is required." });
    const result = await supabasePersistence.followArtist({
      artistId: Number(req.params.id),
      deviceId,
      listenerId: listener?.id || null,
    });
    if (result.notFound) return res.status(404).json({ detail: "Artist not found." });
    return res.json(result);
  }

  const db = await loadDb();
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  const listener = findListenerByToken(db, req);
  const deviceId = getDeviceId(req);
  if (!artist || !isPublicArtist(artist)) {
    return res.status(404).json({ detail: "Artist not found." });
  }
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
  if (USE_SUPABASE_PERSISTENCE) {
    const listener = await supabaseListenerFromRequest(req);
    const deviceId = getDeviceId(req);
    if (!deviceId && !listener)
      return res.status(400).json({ detail: "device_id or login is required." });
    const result = await supabasePersistence.unfollowArtist({
      artistId: Number(req.params.id),
      deviceId,
      listenerId: listener?.id || null,
    });
    if (result.notFound) return res.status(404).json({ detail: "Artist not found." });
    return res.json(result);
  }

  const db = await loadDb();
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  const listener = findListenerByToken(db, req);
  const deviceId = getDeviceId(req);
  if (!artist || !isPublicArtist(artist)) {
    return res.status(404).json({ detail: "Artist not found." });
  }
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

app.get("/api/support/help-center/", (req, res) => {
  res.json(supportHelpCenterPayload());
});

app.get("/api/support/tickets/", async (req, res) => {
  if (!USE_SUPABASE_PERSISTENCE) {
    return res.status(503).json({ detail: "Support requires Supabase persistence." });
  }
  const listener = await requireSupabaseListener(req, res);
  if (!listener) return;
  const tickets = await supabasePersistence.listSupportTicketsForListener(listener.id);
  res.json(supportTicketListPayload(tickets, "/api/support/tickets"));
});

app.post(
  "/api/support/tickets/",
  upload.single("support_attachment"),
  async (req, res) => {
    if (!USE_SUPABASE_PERSISTENCE) {
      return res.status(503).json({ detail: "Support requires Supabase persistence." });
    }
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;

    const payload = supportFormPayload(req, listener);
    const validationError =
      supportPayloadError(payload) || supportAttachmentError(req.file);
    if (validationError) {
      return res.status(400).json({ detail: validationError });
    }

    const reference = createSupportReference();
    const attachment = await uploadSupportAttachmentIfPresent(req.file, reference);
    const ticket = await supabasePersistence.createSupportTicket({
      accountEmail: listener.email || "",
      accountUsername: listener.name || "",
      attachment,
      category: payload.category,
      listenerId: listener.id,
      message: payload.message,
      priority: payload.priority,
      reference,
      requesterRole: payload.requesterRole,
      subject: payload.subject,
    });

    res.status(201).json(attachSupportUrls(ticket, "/api/support/tickets"));
  },
);

app.get("/api/support/tickets/:id/", async (req, res) => {
  if (!USE_SUPABASE_PERSISTENCE) {
    return res.status(503).json({ detail: "Support requires Supabase persistence." });
  }
  const listener = await requireSupabaseListener(req, res);
  if (!listener) return;
  const ticket = await supabasePersistence.getSupportTicketForListener(
    listener.id,
    req.params.id,
  );
  if (!ticket) return res.status(404).json({ detail: "Support ticket not found." });
  res.json(attachSupportUrls(ticket, "/api/support/tickets"));
});

app.post(
  "/api/support/tickets/:id/replies/",
  upload.single("support_attachment"),
  async (req, res) => {
    if (!USE_SUPABASE_PERSISTENCE) {
      return res.status(503).json({ detail: "Support requires Supabase persistence." });
    }
    const listener = await requireSupabaseListener(req, res);
    if (!listener) return;
    const message = cleanText(req.body?.message);
    if (message.length < 2) {
      return res.status(400).json({ detail: "Enter a reply message." });
    }
    const attachmentValidation = supportAttachmentError(req.file);
    if (attachmentValidation) {
      return res.status(400).json({ detail: attachmentValidation });
    }

    const attachment = await uploadSupportAttachmentIfPresent(
      req.file,
      `ticket-${req.params.id}`,
    );
    const result = await supabasePersistence.addSupportTicketReply({
      attachment,
      listenerId: listener.id,
      message,
      ticketIdentifier: req.params.id,
    });
    if (result?.notFound) {
      return res.status(404).json({ detail: "Support ticket not found." });
    }
    if (result?.notOpen) {
      return res.status(409).json({ detail: "This ticket is resolved or closed." });
    }
    res.status(201).json(attachSupportUrls(result.ticket, "/api/support/tickets"));
  },
);

app.get("/api/support/tickets/:id/attachments/:kind/:attachmentId/", async (req, res) => {
  if (!USE_SUPABASE_PERSISTENCE) {
    return res.status(503).json({ detail: "Support requires Supabase persistence." });
  }
  const listener = await requireSupabaseListener(req, res);
  if (!listener) return;
  const kind = cleanText(req.params.kind);
  if (!["message", "ticket"].includes(kind)) {
    return res.status(404).json({ detail: "Attachment not found." });
  }
  const attachment = await supabasePersistence.supportAttachmentForListener({
    attachmentId: req.params.attachmentId,
    kind,
    listenerId: listener.id,
    ticketIdentifier: req.params.id,
  });
  if (!attachment) return res.status(404).json({ detail: "Attachment not found." });
  await supabasePersistence.streamSupportAttachment(attachment, req, res);
});

app.post("/api/reports/", async (req, res) => {
  const db = await loadDb();
  const listener = findListenerByToken(db, req);
  if (listener?.status === "suspended") {
    return res.status(403).json({ detail: "This account is suspended." });
  }

  const targetType = cleanText(req.body?.target_type || req.body?.type);
  const targetId = Number(req.body?.target_id);
  const reason = cleanText(req.body?.reason);
  const allowedTargets = new Set(["song", "artist", "artwork", "user", "account"]);
  if (!allowedTargets.has(targetType)) {
    return res.status(400).json({ detail: "Choose what you are reporting." });
  }
  if (!targetId) return res.status(400).json({ detail: "Choose the reported item." });
  if (reason.length < 4) return res.status(400).json({ detail: "Enter a report reason." });

  const now = nowIso();
  const report = {
    id: db.nextIds.report++,
    reporter: listener?.id || null,
    target_type: targetType,
    target_id: targetId,
    reason,
    status: "open",
    notes: "",
    created_at: now,
    updated_at: now,
  };
  db.reports.push(report);
  await saveDb(db);
  res.status(201).json({ report: serializeReport(db, report) });
});

function serializeReport(db, report) {
  const reporter = report.reporter
    ? db.listeners.find((listener) => Number(listener.id) === Number(report.reporter))
    : null;
  return {
    id: report.id,
    reporter: publicListener(reporter),
    target_type: report.target_type || "content",
    target_id: report.target_id || null,
    reason: report.reason || "",
    status: report.status || "open",
    notes: report.notes || "",
    created_at: report.created_at,
    updated_at: report.updated_at,
  };
}

function serializeAdminUser(db, listener) {
  const artist = listener.artist_id
    ? db.artists.find((item) => Number(item.id) === Number(listener.artist_id))
    : null;
  const sessions = db.authTokens.filter(
    (session) => Number(session.listener) === Number(listener.id),
  );
  const latestSession = [...sessions].sort((first, second) =>
    String(second.last_active_at || second.created_at || "").localeCompare(
      String(first.last_active_at || first.created_at || ""),
    ),
  )[0];
  const releases = db.releases.filter(
    (release) => Number(release.listener) === Number(listener.id),
  );

  return {
    id: listener.id,
    name: listener.name || "",
    email: listener.email || "",
    phone: listener.phone || "",
    role: listener.role || "listener",
    plan: listener.plan || "free",
    status: listener.status || "active",
    artist_id: listener.artist_id || null,
    artist_name: artist?.name || "",
    artist_status: artist?.status || "",
    artist_application_id: listener.artist_application_id || null,
    release_count: releases.length,
    session_count: sessions.length,
    last_active_at: latestSession?.last_active_at || latestSession?.created_at || null,
    created_at: listener.created_at,
    updated_at: listener.updated_at,
  };
}

function serializeGenre(genre) {
  return {
    id: genre.id,
    name: genre.name,
    active: genre.active !== false,
    position: Number(genre.position || 0),
    created_at: genre.created_at,
    updated_at: genre.updated_at,
  };
}

function serializeAuditLog(entry) {
  return {
    id: entry.id,
    admin_user: entry.admin_user,
    admin_role: entry.admin_role,
    action: entry.action,
    target_type: entry.target_type,
    target_id: entry.target_id,
    details: entry.details || {},
    reason: entry.reason || "",
    created_at: entry.created_at,
  };
}

function dateWithinDays(value, days) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

function dashboardPayload(db) {
  const publishedSongs = db.songs.filter((song) => song.status === "published");
  const visibleArtists = db.artists.filter((artist) => artist.status !== "removed");
  const reportsRequiringAttention = db.reports.filter((report) =>
    ["open", "reviewing"].includes(report.status),
  );
  const newUsers = db.listeners.filter((listener) =>
    dateWithinDays(listener.created_at, 7),
  );
  const newReleases = db.releases.filter((release) =>
    dateWithinDays(release.created_at, 7),
  );

  return {
    total_users: db.listeners.length,
    total_approved_artists: visibleArtists.length,
    pending_artist_applications: db.artistApplications.filter(
      (application) => application.status === "pending",
    ).length,
    total_published_songs: publishedSongs.length,
    releases_under_review: db.releases.filter(
      (release) => release.status === "under_review",
    ).length,
    total_streams: db.songs.reduce(
      (total, song) => total + numberOrZero(song.play_count),
      0,
    ),
    new_users_7d: newUsers.length,
    new_releases_7d: newReleases.length,
    reports_requiring_attention: reportsRequiringAttention.length,
  };
}

function settingsPayloadFromBody(req, currentSettings) {
  const next = normalizePlatformSettings({
    ...currentSettings,
    ...req.body,
    feature_flags: {
      ...currentSettings.feature_flags,
      ...(req.body?.feature_flags || {}),
    },
  });

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "supported_audio_formats")) {
    next.supported_audio_formats = Array.isArray(req.body.supported_audio_formats)
      ? req.body.supported_audio_formats
      : String(req.body.supported_audio_formats || "")
          .split(",")
          .map((format) => format.trim())
          .filter(Boolean);
  }

  return normalizePlatformSettings(next);
}

app.get("/admin-api/me", requireAdmin, async (req, res) => {
  await setAudioPreviewCookie(req, res);
  res.json({ admin: req.adminUser });
});

app.delete("/admin-api/audio-preview-session", requireAdmin, async (req, res) => {
  await adminAccounts.revokePreview(req, res);
  res.clearCookie(AUDIO_COOKIE, { httpOnly: true, secure: req.secure, sameSite: "strict", path: "/api/" });
  res.status(204).end();
});

app.get("/admin-api/dashboard", requireAdminPermission("artists", "catalog", "releases", "reports"), async (req, res) => {
  const db = await loadDb();
  res.json(dashboardPayload(db));
});

app.get(
  "/admin-api/support/tickets",
  requireAdminPermission("support:view"),
  async (req, res) => {
    if (!USE_SUPABASE_PERSISTENCE) {
      return res.status(503).json({ detail: "Support requires Supabase persistence." });
    }
    const tickets = await supabasePersistence.listSupportTicketsForAdmin({
      category: cleanText(req.query?.category),
      search: cleanText(req.query?.search),
      status: cleanText(req.query?.status),
    });
    res.json(supportTicketListPayload(tickets, "/admin-api/support/tickets"));
  },
);

app.get(
  "/admin-api/support/tickets/:id",
  requireAdminPermission("support:view"),
  async (req, res) => {
    if (!USE_SUPABASE_PERSISTENCE) {
      return res.status(503).json({ detail: "Support requires Supabase persistence." });
    }
    const ticket = await supabasePersistence.getSupportTicketForAdmin(req.params.id);
    if (!ticket) return res.status(404).json({ detail: "Support ticket not found." });
    res.json(attachSupportUrls(ticket, "/admin-api/support/tickets"));
  },
);

app.post(
  "/admin-api/support/tickets/:id/replies",
  requireAdminPermission("support:reply"),
  async (req, res) => {
    if (!USE_SUPABASE_PERSISTENCE) {
      return res.status(503).json({ detail: "Support requires Supabase persistence." });
    }
    const message = cleanText(req.body?.message);
    if (message.length < 2) {
      return res.status(400).json({ detail: "Enter a public reply." });
    }
    const result = await supabasePersistence.addSupportAdminReply({
      adminUsername: req.adminUser.username,
      message,
      ticketIdentifier: req.params.id,
    });
    if (result?.notFound) {
      return res.status(404).json({ detail: "Support ticket not found." });
    }
    if (result?.closed) {
      return res.status(409).json({ detail: "Closed tickets cannot be replied to." });
    }
    await auditSupportAction(req, "support_public_reply", result.ticket.id, {
      reference: result.ticket.reference,
    });
    res.status(201).json(attachSupportUrls(result.ticket, "/admin-api/support/tickets"));
  },
);

app.post(
  "/admin-api/support/tickets/:id/notes",
  requireAdminPermission("support:note"),
  async (req, res) => {
    if (!USE_SUPABASE_PERSISTENCE) {
      return res.status(503).json({ detail: "Support requires Supabase persistence." });
    }
    const note = cleanText(req.body?.note);
    if (note.length < 2) {
      return res.status(400).json({ detail: "Enter an internal note." });
    }
    const internalNote = await supabasePersistence.addSupportInternalNote({
      adminUsername: req.adminUser.username,
      note,
      ticketIdentifier: req.params.id,
    });
    if (!internalNote) {
      return res.status(404).json({ detail: "Support ticket not found." });
    }
    await auditSupportAction(req, "support_internal_note", internalNote.ticket_id, {});
    const ticket = await supabasePersistence.getSupportTicketForAdmin(
      internalNote.ticket_id,
    );
    res.status(201).json(attachSupportUrls(ticket, "/admin-api/support/tickets"));
  },
);

app.patch(
  "/admin-api/support/tickets/:id",
  requireAdminPermission("support:update"),
  async (req, res) => {
    if (!USE_SUPABASE_PERSISTENCE) {
      return res.status(503).json({ detail: "Support requires Supabase persistence." });
    }
    const status = Object.prototype.hasOwnProperty.call(req.body || {}, "status")
      ? cleanText(req.body?.status)
      : "";
    const priority = Object.prototype.hasOwnProperty.call(req.body || {}, "priority")
      ? cleanText(req.body?.priority)
      : "";
    const assignedTo = Object.prototype.hasOwnProperty.call(req.body || {}, "assigned_to")
      ? cleanText(req.body?.assigned_to)
      : undefined;

    if (status && !SUPPORT_TICKET_STATUSES.has(status)) {
      return res.status(400).json({ detail: "Choose a valid support status." });
    }
    if (priority && !SUPPORT_TICKET_PRIORITIES.has(priority)) {
      return res.status(400).json({ detail: "Choose a valid support priority." });
    }

    const ticket = await supabasePersistence.updateSupportTicketForAdmin({
      assignedTo,
      changedBy: req.adminUser.username,
      priority,
      status,
      ticketIdentifier: req.params.id,
    });
    if (!ticket) return res.status(404).json({ detail: "Support ticket not found." });
    await auditSupportAction(req, "support_update_ticket", ticket.id, {
      assigned_to: assignedTo,
      priority,
      status,
    });
    res.json(attachSupportUrls(ticket, "/admin-api/support/tickets"));
  },
);

app.get(
  "/admin-api/support/tickets/:id/attachments/:kind/:attachmentId",
  requireAdminPermission("support:view"),
  async (req, res) => {
    if (!USE_SUPABASE_PERSISTENCE) {
      return res.status(503).json({ detail: "Support requires Supabase persistence." });
    }
    const kind = cleanText(req.params.kind);
    if (!["message", "ticket"].includes(kind)) {
      return res.status(404).json({ detail: "Attachment not found." });
    }
    const attachment = await supabasePersistence.supportAttachmentForAdmin({
      attachmentId: req.params.attachmentId,
      kind,
      ticketIdentifier: req.params.id,
    });
    if (!attachment) return res.status(404).json({ detail: "Attachment not found." });
    await supabasePersistence.streamSupportAttachment(attachment, req, res);
  },
);

app.get("/admin-api/users", requireAdminPermission("users"), async (req, res) => {
  const db = await loadDb();
  const search = cleanText(req.query?.search).toLowerCase();
  const role = cleanText(req.query?.role);
  const status = cleanText(req.query?.status);
  const users = db.listeners
    .filter((listener) => !role || listener.role === role)
    .filter((listener) => !status || listener.status === status)
    .filter((listener) => {
      if (!search) return true;
      return [
        listener.id,
        listener.name,
        listener.email,
        listener.phone,
        listener.role,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .sort((first, second) =>
      String(second.created_at || "").localeCompare(String(first.created_at || "")),
    );
  res.json(users.map((listener) => serializeAdminUser(db, listener)));
});

app.post("/admin-api/users/:id/suspend", requireAdminPermission("users"), async (req, res) => {
  const db = await loadDb();
  const listener = db.listeners.find((item) => Number(item.id) === Number(req.params.id));
  if (!listener) return res.status(404).json({ detail: "User not found." });
  const reason = cleanText(req.body?.reason);
  if (!reason) return res.status(400).json({ detail: "Enter a suspension reason." });
  listener.status = "suspended";
  listener.suspension_reason = reason;
  listener.updated_at = nowIso();
  appendAuditLog(db, req, "suspend_user", "user", listener.id, { reason });
  await saveDb(db);
  res.json(serializeAdminUser(db, listener));
});

app.post("/admin-api/users/:id/restore", requireAdminPermission("users"), async (req, res) => {
  const db = await loadDb();
  const listener = db.listeners.find((item) => Number(item.id) === Number(req.params.id));
  if (!listener) return res.status(404).json({ detail: "User not found." });
  listener.status = "active";
  listener.suspension_reason = "";
  listener.updated_at = nowIso();
  appendAuditLog(db, req, "restore_user", "user", listener.id, {});
  await saveDb(db);
  res.json(serializeAdminUser(db, listener));
});

app.post(
  "/admin-api/users/:id/revoke-sessions",
  requireSuperAdmin,
  async (req, res) => {
    const db = await loadDb();
    const listener = db.listeners.find((item) => Number(item.id) === Number(req.params.id));
    if (!listener) return res.status(404).json({ detail: "User not found." });
    const beforeCount = db.authTokens.length;
    db.authTokens = db.authTokens.filter(
      (session) => Number(session.listener) !== Number(listener.id),
    );
    const revoked = beforeCount - db.authTokens.length;
    appendAuditLog(db, req, "revoke_user_sessions", "user", listener.id, { revoked });
    await saveDb(db);
    res.json({ revoked, user: serializeAdminUser(db, listener) });
  },
);

app.get("/admin-api/genres", requireAdminPermission("genres", "catalog"), async (req, res) => {
  const db = await loadDb();
  // Catalog editors need active choices, not genre-management metadata or writes.
  res.json(adminCan(req.adminUser, "genres") ? db.genres.map(serializeGenre) :
    db.genres.filter((genre) => genre.active !== false).map(({ id, name }) => ({ id, name, active: true })));
});

app.post("/admin-api/genres", requireAdminPermission("genres"), async (req, res) => {
  const db = await loadDb();
  const name = cleanText(req.body?.name);
  if (name.length < 2) return res.status(400).json({ detail: "Enter a genre name." });
  const duplicate = db.genres.find((genre) => genre.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return res.status(409).json({ detail: "Genre already exists." });
  const now = nowIso();
  const genre = {
    id: db.nextIds.genre++,
    name,
    active: true,
    position: Number(req.body?.position || db.genres.length + 1),
    created_at: now,
    updated_at: now,
  };
  db.genres.push(genre);
  appendAuditLog(db, req, "create_genre", "genre", genre.id, { name });
  await saveDb(db);
  res.status(201).json(serializeGenre(genre));
});

app.put("/admin-api/genres/:id", requireAdminPermission("genres"), async (req, res) => {
  const db = await loadDb();
  const genre = db.genres.find((item) => Number(item.id) === Number(req.params.id));
  if (!genre) return res.status(404).json({ detail: "Genre not found." });
  const name = cleanText(req.body?.name);
  if (name.length < 2) return res.status(400).json({ detail: "Enter a genre name." });
  const duplicate = db.genres.find(
    (item) =>
      Number(item.id) !== Number(genre.id) &&
      item.name.toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) return res.status(409).json({ detail: "Genre already exists." });
  const previousName = genre.name;
  genre.name = name;
  genre.position = Number(req.body?.position || genre.position || 0);
  genre.updated_at = nowIso();
  appendAuditLog(db, req, "update_genre", "genre", genre.id, { previousName, name });
  await saveDb(db);
  res.json(serializeGenre(genre));
});

app.post(
  "/admin-api/genres/:id/activate",
  requireAdminPermission("genres"),
  async (req, res) => {
    const db = await loadDb();
    const genre = db.genres.find((item) => Number(item.id) === Number(req.params.id));
    if (!genre) return res.status(404).json({ detail: "Genre not found." });
    genre.active = true;
    genre.updated_at = nowIso();
    appendAuditLog(db, req, "activate_genre", "genre", genre.id, {});
    await saveDb(db);
    res.json(serializeGenre(genre));
  },
);

app.post(
  "/admin-api/genres/:id/deactivate",
  requireAdminPermission("genres"),
  async (req, res) => {
    const db = await loadDb();
    const genre = db.genres.find((item) => Number(item.id) === Number(req.params.id));
    if (!genre) return res.status(404).json({ detail: "Genre not found." });
    genre.active = false;
    genre.updated_at = nowIso();
    appendAuditLog(db, req, "deactivate_genre", "genre", genre.id, {});
    await saveDb(db);
    res.json(serializeGenre(genre));
  },
);

app.get(
  "/admin-api/platform-settings",
  requireAdminPermission("settings"),
  async (req, res) => {
    const db = await loadDb();
    res.json(platformSettingsFor(db));
  },
);

app.put(
  "/admin-api/platform-settings",
  requireAdminPermission("settings"),
  async (req, res) => {
    const db = await loadDb();
    const currentSettings = platformSettingsFor(db);
    const nextSettings = settingsPayloadFromBody(req, currentSettings);
    nextSettings.updated_at = nowIso();
    nextSettings.updated_by = req.adminUser.username;
    db.platformSettings = nextSettings;
    appendAuditLog(db, req, "update_platform_settings", "platform_settings", null, {
      changed_keys: Object.keys(req.body || {}),
    });
    await saveDb(db);
    res.json(platformSettingsFor(db));
  },
);

app.get("/admin-api/feature-flags", requireAdminPermission("settings"), async (req, res) => {
  const db = await loadDb();
  res.json(featureFlagsFor(db));
});

app.put("/admin-api/feature-flags", requireAdminPermission("settings"), async (req, res) => {
  const db = await loadDb();
  const settings = platformSettingsFor(db);
  settings.feature_flags = {
    ...settings.feature_flags,
    ...(req.body || {}),
  };
  db.platformSettings = normalizePlatformSettings({
    ...settings,
    updated_at: nowIso(),
    updated_by: req.adminUser.username,
  });
  appendAuditLog(db, req, "update_feature_flags", "feature_flags", null, {
    changed_keys: Object.keys(req.body || {}),
  });
  await saveDb(db);
  res.json(featureFlagsFor(db));
});

app.get("/admin-api/reports", requireAdminPermission("reports"), async (req, res) => {
  const db = await loadDb();
  const status = cleanText(req.query?.status);
  const reports = db.reports
    .filter((report) => !status || report.status === status)
    .sort((first, second) =>
      String(second.created_at || "").localeCompare(String(first.created_at || "")),
    );
  res.json(reports.map((report) => serializeReport(db, report)));
});

app.post("/admin-api/reports/:id/status", requireAdminPermission("reports"), async (req, res) => {
  const db = await loadDb();
  const report = db.reports.find((item) => Number(item.id) === Number(req.params.id));
  if (!report) return res.status(404).json({ detail: "Report not found." });
  const status = cleanText(req.body?.status);
  if (!REPORT_STATUSES.has(status)) {
    return res.status(400).json({ detail: "Choose a valid report status." });
  }
  report.status = status;
  report.notes = cleanText(req.body?.notes);
  report.updated_at = nowIso();
  appendAuditLog(db, req, "update_report_status", "report", report.id, {
    status,
    notes: report.notes,
  });
  await saveDb(db);
  res.json(serializeReport(db, report));
});

app.get("/admin-api/discovery", requireAdminPermission("discovery"), async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  res.json({
    featured_artists: sortArtists(
      db.artists.filter((artist) => artist.status !== "removed" && artist.is_featured),
    ).map((artist) => serializeArtist(db, req, artist)),
    featured_songs: sortSongs(
      db.songs.filter((song) => song.status !== "removed" && song.is_featured),
    ).map((song) => serializeSong(db, req, song)),
    popular_right_now: sortSongs(db.songs.filter((song) => song.status !== "removed"))
      .slice(0, 12)
      .map((song) => serializeSong(db, req, song)),
  });
});

app.get("/admin-api/platform-health", requireSuperAdmin, async (req, res) => {
  const db = await loadDb();
  const [dbStatResult, uploadsStatResult] = USE_SUPABASE_PERSISTENCE
    ? [{ status: "rejected" }, { status: "rejected" }]
    : await Promise.allSettled([fs.stat(DB_PATH), fs.stat(UPLOADS_DIR)]);
  const dbStat = dbStatResult.status === "fulfilled" ? dbStatResult.value : null;
  const uploadsStat = uploadsStatResult.status === "fulfilled" ? uploadsStatResult.value : null;
  res.json({
    backend_status: "ok",
    app_backend_version: "teso-tunes-backend-js@1.0.0",
    persistence_backend: PERSISTENCE_BACKEND,
    database: {
      type: USE_SUPABASE_PERSISTENCE ? "supabase-postgres" : "json-file",
      available: USE_SUPABASE_PERSISTENCE || Boolean(dbStat?.isFile()),
      path_kind: USE_SUPABASE_PERSISTENCE ? "supabase-postgres" : "local-render-filesystem",
      updated_at: dbStat?.mtime?.toISOString?.() || null,
      bytes: dbStat?.size || 0,
    },
    media_storage: {
      type: USE_SUPABASE_PERSISTENCE ? "supabase-storage" : "local-uploads-folder",
      available: USE_SUPABASE_PERSISTENCE || Boolean(uploadsStat?.isDirectory()),
      path_kind: USE_SUPABASE_PERSISTENCE ? "supabase-storage" : "local-render-filesystem",
    },
    counts: dashboardPayload(db),
    warnings: USE_SUPABASE_PERSISTENCE
      ? []
      : [
          "Production data still uses JSON files and local uploads. Render local storage can be reset on restart/deploy.",
          "Permanent target is PostgreSQL for data plus object storage for audio/artwork.",
        ],
  });
});

app.get("/admin-api/audit-log", requireSuperAdmin, async (req, res) => {
  const db = await loadDb();
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 100)));
  res.json(
    [...db.adminAuditLogs]
      .sort((first, second) =>
        String(second.created_at || "").localeCompare(String(first.created_at || "")),
      )
      .slice(0, limit)
      .map(serializeAuditLog),
  );
});

app.get("/admin-api/persistence-export", requireSuperAdmin, async (req, res) => {
  const includeSensitive =
    req.query?.include_sensitive === "true" &&
    req.query?.confirm === "EXPORT RAW HASHES";
  const db = await loadDb();
  const exportedDb = includeSensitive
    ? db
    : {
        ...db,
        authTokens: db.authTokens.map((session) => ({
          ...session,
          token_hash: session.token_hash ? "[redacted]" : "",
        })),
        listeners: db.listeners.map((listener) => ({
          ...listener,
          password_hash: listener.password_hash ? "[redacted]" : "",
        })),
      };

  await adminAccounts.recordAction(req, "admin_persistence_export", null, {includes_sensitive_hashes:includeSensitive});
  res.set("cache-control", "no-store");
  res.json({
    exported_at: nowIso(),
    includes_sensitive_hashes: includeSensitive,
    warning: includeSensitive
      ? "This export includes password/session hashes. Store it privately and delete temporary copies after migration validation."
      : "Sensitive hashes are redacted. Add include_sensitive=true&confirm=EXPORT%20RAW%20HASHES for a migration export.",
    db: exportedDb,
  });
});

app.get("/admin-api/supabase-migration/jobs", requireSuperAdmin, (req, res) => {
  res.json(
    [...migrationJobs.values()]
      .sort((first, second) =>
        String(second.startedAt).localeCompare(String(first.startedAt)),
      )
      .map(migrationJobSnapshot),
  );
});

app.get("/admin-api/supabase-migration/jobs/:id", requireSuperAdmin, (req, res) => {
  const job = migrationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ detail: "Migration job not found." });
  res.json(migrationJobSnapshot(job));
});

app.post("/admin-api/supabase-migration/schema", requireSuperAdmin, async (req, res) => {
  if (!requireMigrationConfirmation(req, res, "schema")) return;
  const activeJob = [...migrationJobs.values()].find((job) => job.status === "running");
  if (activeJob) {
    return res.status(409).json({
      detail: "A migration job is already running.",
      job: migrationJobSnapshot(activeJob),
    });
  }
  await adminAccounts.recordAction(req, "admin_migration_requested", null, {kind:"schema"});
  const job = startMigrationJob("schema", "apply-supabase-schema.js");
  res.status(202).json({ job: migrationJobSnapshot(job) });
});

app.post("/admin-api/supabase-migration/migrate", requireSuperAdmin, async (req, res) => {
  if (!requireMigrationConfirmation(req, res, "migrate")) return;
  const activeJob = [...migrationJobs.values()].find((job) => job.status === "running");
  if (activeJob) {
    return res.status(409).json({
      detail: "A migration job is already running.",
      job: migrationJobSnapshot(activeJob),
    });
  }
  await adminAccounts.recordAction(req, "admin_migration_requested", null, {kind:"migrate"});
  const job = startMigrationJob("migrate", "migrate-json-to-supabase.js", {
    MIGRATION_SOURCE_NAME: `render-json-${Date.now()}`,
  });
  res.status(202).json({ job: migrationJobSnapshot(job) });
});

app.post("/admin-api/supabase-migration/validate", requireSuperAdmin, async (req, res) => {
  if (!requireMigrationConfirmation(req, res, "validate")) return;
  const activeJob = [...migrationJobs.values()].find((job) => job.status === "running");
  if (activeJob) {
    return res.status(409).json({
      detail: "A migration job is already running.",
      job: migrationJobSnapshot(activeJob),
    });
  }
  await adminAccounts.recordAction(req, "admin_migration_requested", null, {kind:"validate"});
  const job = startMigrationJob("validate", "validate-supabase-migration.js", {
    VALIDATE_STORAGE: "1",
  });
  res.status(202).json({ job: migrationJobSnapshot(job) });
});

app.get("/admin-api/artist-applications", requireAdminPermission("applications"), async (req, res) => {
  const db = await loadDb();
  const status = cleanText(req.query?.status);
  if (status && !["pending", "approved", "rejected", "changes_requested"].includes(status)) {
    return res.status(400).json({ detail: "Unknown application status." });
  }
  const search = cleanText(req.query?.search).toLowerCase();
  const applications = db.artistApplications
    .map((application) => serializeArtistApplication(db, req, application))
    .filter((application) => !status || application.status === status)
    .filter((application) => !search || [application.artist_name, application.contact_name,
      application.applicant?.name, application.applicant?.email, application.email, application.listener]
      .some((value) => String(value ?? "").toLowerCase().includes(search)))
    .sort((first, second) => {
      const attention = (row) => ["pending", "changes_requested"].includes(row.status) ? 0 : 1;
      return attention(first) - attention(second) ||
        String(second.created_at || "").localeCompare(String(first.created_at || "")) || Number(second.id) - Number(first.id);
    });
  res.set("Cache-Control", "no-store").json(applications);
});

app.get("/admin-api/artist-applications/:id", requireAdminPermission("applications"), async (req, res) => {
  const db = await loadDb();
  const application = db.artistApplications.find((row) => Number(row.id) === Number(req.params.id));
  if (!application) return res.status(404).json({ detail: "Application not found." });
  const reviewActions = ["approve_artist_application", "reject_artist_application", "request_artist_application_changes"];
  // Only this application's review history, not the privileged global audit log.
  const history = db.adminAuditLogs.filter((entry) => entry.target_type === "artist_application" &&
    Number(entry.target_id) === Number(application.id) && reviewActions.includes(entry.action))
    .map((entry) => ({action:entry.action, at:entry.created_at, admin_user:entry.admin_user,
      admin_role:entry.admin_role, reason:entry.reason || entry.details?.review_reason || ""}))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  res.set("Cache-Control", "no-store").json({...serializeArtistApplication(db, req, application),
    reviewed_by:application.reviewed_by || "", history});
});

app.post(
  "/admin-api/artist-applications/:id/approve",
  requireAdminPermission("applications"),
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
    if (!["pending", "changes_requested"].includes(application.status) ||
        Number(latestApplicationForListener(db, listener.id)?.id) !== Number(application.id) ||
        listener.role === "artist" || listener.artist_id || listener.status === "suspended") {
      return res.status(409).json({ detail: "This application or account is no longer eligible for approval. Refresh before reviewing." });
    }
    if (application.artist) {
      const linked = db.artists.find((row) => Number(row.id) === Number(application.artist));
      if (!linked || Number(linked.owner_listener) !== Number(listener.id) ||
          Number(linked.source_application_id) !== Number(application.id) || linked.status !== "active") {
        return res.status(409).json({ detail: "The existing artist linkage needs review before this application can be approved." });
      }
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
    appendAuditLog(db, req, "approve_artist_application", "artist_application", application.id, {
      artist_id: artist.id,
      review_reason: application.review_reason,
    });
    try {
      await saveDb(db);
    } catch (error) {
      if (error?.code !== "STALE_WRITE") throw error;
      // A duplicate approval racing on another instance can return the committed
      // result. Other conflicts still fail closed and require a fresh review.
      const current = await loadDb();
      const approved = current.artistApplications.find((row) => Number(row.id) === Number(application.id));
      if (approved?.status !== "approved") throw error;
      return res.json(serializeArtistApplication(current, req, approved));
    }
    res.json(serializeArtistApplication(db, req, application));
  },
);

app.post(
  "/admin-api/artist-applications/:id/reject",
  requireAdminPermission("applications"),
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
    if (application.status === "rejected" && application.rejection_reason === reason) {
      return res.json(serializeArtistApplication(db, req, application));
    }
    if (!["pending", "changes_requested"].includes(application.status) ||
        Number(latestApplicationForListener(db, application.listener)?.id) !== Number(application.id)) {
      return res.status(409).json({ detail: "This application has already been reviewed or replaced. Refresh before reviewing." });
    }

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
    appendAuditLog(db, req, "reject_artist_application", "artist_application", application.id, {
      reason,
    });
    await saveDb(db);
    res.json(serializeArtistApplication(db, req, application));
  },
);

app.post(
  "/admin-api/artist-applications/:id/request-changes",
  requireAdminPermission("applications"),
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
    if (application.status === "changes_requested" && application.review_reason === reason) {
      return res.json(serializeArtistApplication(db, req, application));
    }
    if (!["pending", "changes_requested"].includes(application.status) ||
        Number(latestApplicationForListener(db, application.listener)?.id) !== Number(application.id)) {
      return res.status(409).json({ detail: "This application has already been reviewed or replaced. Refresh before reviewing." });
    }

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
    appendAuditLog(db, req, "request_artist_application_changes", "artist_application", application.id, {
      reason,
    });
    await saveDb(db);
    res.json(serializeArtistApplication(db, req, application));
  },
);

app.get("/admin-api/releases", requireAdminPermission("releases"), async (req, res) => {
  const db = await loadDb();
  const status = cleanText(req.query?.status);
  if (status && !["draft", "under_review", "approved", "rejected", "scheduled", "published"].includes(status)) {
    return res.status(400).json({detail:"Unknown release status."});
  }
  const search = cleanText(req.query?.search).toLowerCase();
  const publication = cleanText(req.query?.publication);
  if (publication && !["approved_scheduled", "due", "future", "eligible"].includes(publication)) {
    return res.status(400).json({detail:"Unknown publication filter."});
  }
  const releases = db.releases
    .filter((release) => !status || release.status === status)
    .map((release) => serializeReleaseReview(db, req, release))
    .filter((release) => !publication || (release.publication.candidate &&
      (publication === "approved_scheduled" || (publication === "eligible" ? release.publication.eligible : release.publication.timing === publication))))
    .filter((release) => !search || [release.title, release.artist_name].some((value) => value.toLowerCase().includes(search)))
    .sort((a, b) => Number(b.status === "under_review") - Number(a.status === "under_review") ||
      String(b.submitted_at || b.created_at || "").localeCompare(String(a.submitted_at || a.created_at || "")) || Number(b.id) - Number(a.id));
  res.set("Cache-Control", "no-store");
  res.json(releases);
});

app.get("/admin-api/releases/:id", requireAdminPermission("releases"), async (req, res) => {
  const db = await loadDb();
  const release = db.releases.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!release) return res.status(404).json({ detail: "Release not found." });
  res.set("Cache-Control", "no-store");
  res.json(serializeReleaseReview(db, req, release));
});

app.post("/admin-api/releases/:id/approve", requireAdminPermission("releases"), async (req, res) => {
  const db = await loadDb();
  const release = db.releases.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!release) return res.status(404).json({ detail: "Release not found." });
  if (["scheduled", "published"].includes(release.status) && release.approved_at) {
    return res.json(serializeReleaseReview(db, req, release));
  }
  if (release.status !== "under_review" || release.public_song || !releaseReviewIsCurrent(req, release) ||
    db.songs.some((song) => Number(song.source_release_id) === Number(release.id))) {
    return res.status(409).json({ detail: "This release is no longer the submission you reviewed. Refresh it." });
  }
  if (!releaseLinkageValid(db, release)) {
    return res.status(409).json({detail:"Active artist and submitting account linkage must match before approval."});
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

  appendAuditLog(db, req, "approve_release", "release", release.id, {
    status: release.status,
    public_song: release.public_song || null,
    review_reason: release.review_reason,
  });
  try {
    await saveDb(db);
  } catch (error) {
    if (error.code === "STALE_WRITE") {
      const fresh = await loadDb();
      const current = fresh.releases.find((row) => Number(row.id) === Number(release.id));
      if (current?.approved_at && ["scheduled", "published"].includes(current.status)) {
        return res.json(serializeReleaseReview(fresh, req, current));
      }
    }
    throw error;
  }
  res.json(serializeReleaseReview(db, req, release));
});

app.post("/admin-api/releases/:id/reject", requireAdminPermission("releases"), async (req, res) => {
  const db = await loadDb();
  const release = db.releases.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!release) return res.status(404).json({ detail: "Release not found." });
  if (!["under_review", "scheduled"].includes(release.status) || release.public_song || !releaseReviewIsCurrent(req, release)) {
    return res.status(409).json({ detail: "This release changed. Refresh before rejecting it." });
  }

  const reason = cleanText(req.body?.reason || req.body?.rejection_reason);
  if (reason.length < 5) return res.status(400).json({ detail: "Enter a meaningful rejection reason (at least 5 characters)." });

  const now = new Date().toISOString();
  release.status = "rejected";
  release.rejection_reason = reason;
  release.review_reason = reason;
  release.reviewed_by = req.adminUser.username;
  release.updated_at = now;
  appendAuditLog(db, req, "reject_release", "release", release.id, { reason });
  await saveDb(db);
  res.json(serializeRelease(db, req, release));
});

app.post(
  "/admin-api/releases/:id/request-changes",
  requireAdminPermission("releases"),
  async (req, res) => {
    const db = await loadDb();
    const release = db.releases.find(
      (item) => Number(item.id) === Number(req.params.id),
    );
    if (!release) return res.status(404).json({ detail: "Release not found." });
    if (!["under_review", "scheduled"].includes(release.status) || release.public_song || !releaseReviewIsCurrent(req, release)) {
      return res.status(409).json({ detail: "This release changed. Refresh before requesting changes." });
    }

    const reason = cleanText(req.body?.reason || req.body?.review_reason);
    if (reason.length < 5) return res.status(400).json({ detail: "Explain what needs changing (at least 5 characters)." });

    const now = nowIso();
    release.status = "rejected";
    release.rejection_reason = reason;
    release.review_reason = reason;
    release.reviewed_by = req.adminUser.username;
    release.updated_at = now;
    appendAuditLog(db, req, "request_release_changes", "release", release.id, { reason });
    await saveDb(db);
    res.json(serializeRelease(db, req, release));
  },
);

app.get("/admin-api/artists", requireAdminPermission("artists"), async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  res.json(
    sortArtists(db.artists).map((artist) => serializeArtist(db, req, artist)),
  );
});

app.post(
  "/admin-api/artists",
  requireAdminPermission("artists"),
  upload.single("photo_file"),
  async (req, res) => {
    if (!allowFeaturedChange(req, res)) return;
    const db = await loadDb();
    const uploadError = validateUploadSettings(db, { photo_file: req.file ? [req.file] : [] });
    if (uploadError) {
      return res.status(400).json({ detail: uploadError });
    }
    const now = new Date().toISOString();
    const artist = {
      id: db.nextIds.artist++,
      name: req.body.name || "Untitled Artist",
      category: req.body.category || "Other Secular Artists",
      bio: req.body.bio || "",
      photo: (await uploadUrlFor(req.file)) || req.body.photo || "",
      location: req.body.location || "",
      is_featured: boolValue(req.body.is_featured),
      status: ARTIST_STATUSES.has(req.body.status) ? req.body.status : "active",
      created_at: now,
      updated_at: now,
    };
    db.artists.push(artist);
    appendAuditLog(db, req, "create_artist", "artist", artist.id, {
      name: artist.name,
    });
    await saveDb(db);
    res.status(201).json(serializeArtist(db, req, artist));
  },
);

app.put(
  "/admin-api/artists/:id",
  requireAdminPermission("artists"),
  upload.single("photo_file"),
  async (req, res) => {
    const db = await loadDb();
    const artist = db.artists.find(
      (item) => Number(item.id) === Number(req.params.id),
    );
    if (!artist) return res.status(404).json({ detail: "Artist not found." });
    if (!allowFeaturedChange(req, res, artist.is_featured)) return;
    const uploadError = validateUploadSettings(db, { photo_file: req.file ? [req.file] : [] });
    if (uploadError) {
      return res.status(400).json({ detail: uploadError });
    }
    Object.assign(artist, {
      name: req.body.name || artist.name,
      category: req.body.category || artist.category,
      bio: req.body.bio ?? artist.bio,
      photo: (await uploadUrlFor(req.file)) || req.body.photo || artist.photo,
      location: req.body.location ?? artist.location,
      is_featured: adminCan(req.adminUser, "discovery") ? boolValue(req.body.is_featured) : Boolean(artist.is_featured),
      status: ARTIST_STATUSES.has(req.body.status) ? req.body.status : artist.status || "active",
      updated_at: nowIso(),
    });
    appendAuditLog(db, req, "update_artist", "artist", artist.id, {
      name: artist.name,
    });
    await saveDb(db);
    res.json(serializeArtist(db, req, artist));
  },
);

app.delete("/admin-api/artists/:id", requireAdminPermission("artists"), requirePermanentDeletePermission, async (req, res) => {
  const db = await loadDb();
  const id = Number(req.params.id);
  const artist = db.artists.find((item) => Number(item.id) === id);
  if (!artist) return res.status(404).json({ detail: "Artist not found." });

  if (req.query?.confirm === "DELETE FOREVER") {
    db.artists = db.artists.filter((item) => Number(item.id) !== id);
    db.songs = db.songs.filter((song) => Number(song.artist) !== id);
    db.artistFollows = db.artistFollows.filter(
      (follow) => Number(follow.artist) !== id,
    );
    appendAuditLog(db, req, "permanently_delete_artist", "artist", id, {
      reason: cleanText(req.body?.reason || "Permanent delete confirmed"),
    });
    await saveDb(db);
    return res.json({ deleted: true, permanent: true });
  }

  artist.status = "removed";
  artist.removed_at = nowIso();
  artist.updated_at = artist.removed_at;
  appendAuditLog(db, req, "remove_artist", "artist", artist.id, {});
  await saveDb(db);
  res.json({ removed: true, artist: serializeArtist(db, req, artist) });
});

app.post("/admin-api/artists/:id/suspend", requireAdminPermission("artists"), async (req, res) => {
  const db = await loadDb();
  const artist = db.artists.find((item) => Number(item.id) === Number(req.params.id));
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  const reason = cleanText(req.body?.reason);
  if (!reason) return res.status(400).json({ detail: "Enter a suspension reason." });
  artist.status = "suspended";
  artist.suspension_reason = reason;
  artist.updated_at = nowIso();
  appendAuditLog(db, req, "suspend_artist", "artist", artist.id, { reason });
  await saveDb(db);
  res.json(serializeArtist(db, req, artist));
});

app.post("/admin-api/artists/:id/restore", requireAdminPermission("artists"), async (req, res) => {
  const db = await loadDb();
  const artist = db.artists.find((item) => Number(item.id) === Number(req.params.id));
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  artist.status = "active";
  artist.suspension_reason = "";
  artist.removed_at = null;
  artist.updated_at = nowIso();
  appendAuditLog(db, req, "restore_artist", "artist", artist.id, {});
  await saveDb(db);
  res.json(serializeArtist(db, req, artist));
});

app.post("/admin-api/artists/:id/feature", requireAdminPermission("discovery"), async (req, res) => {
  const db = await loadDb();
  const artist = db.artists.find((item) => Number(item.id) === Number(req.params.id));
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  artist.is_featured = true;
  artist.updated_at = nowIso();
  appendAuditLog(db, req, "feature_artist", "artist", artist.id, {});
  await saveDb(db);
  res.json(serializeArtist(db, req, artist));
});

app.post("/admin-api/artists/:id/unfeature", requireAdminPermission("discovery"), async (req, res) => {
  const db = await loadDb();
  const artist = db.artists.find((item) => Number(item.id) === Number(req.params.id));
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  artist.is_featured = false;
  artist.updated_at = nowIso();
  appendAuditLog(db, req, "unfeature_artist", "artist", artist.id, {});
  await saveDb(db);
  res.json(serializeArtist(db, req, artist));
});

app.get("/admin-api/songs", requireAdminPermission("catalog"), async (req, res) => {
  const db = await loadDbWithPublishedReleases();
  res.json(sortSongs(db.songs).map((song) => serializeSong(db, req, song)));
});

app.post(
  "/admin-api/songs",
  requireAdminPermission("catalog"),
  upload.fields([
    { name: "audio_upload", maxCount: 1 },
    { name: "cover_upload", maxCount: 1 },
  ]),
  async (req, res) => {
    if (!allowFeaturedChange(req, res)) return;
    const db = await loadDb();
    const uploadError = validateUploadSettings(db, req.files);
    if (uploadError) {
      return res.status(400).json({ detail: uploadError });
    }
    const audioUrl = audioInput(req.body.audio_file);
    if (audioUrl === null) return res.status(400).json({ detail: "Use an audio upload or a public HTTPS audio URL without credentials." });
    const now = new Date().toISOString();
    const genreData = genrePayload(req, db);
    const song = {
      id: db.nextIds.song++,
      artist: Number(req.body.artist),
      title: req.body.title || "Untitled Song",
      audio_file:
        (await uploadUrlFor(req.files?.audio_upload?.[0])) || audioUrl || "",
      cover_image:
        (await uploadUrlFor(req.files?.cover_upload?.[0])) ||
        req.body.cover_image ||
        "",
      genre: genreData.genre,
      genre_note: genreData.genre_note,
      lyrics: req.body.lyrics || "",
      play_count: numberOrZero(req.body.play_count),
      release_date: req.body.release_date || "",
      is_featured: boolValue(req.body.is_featured),
      status: SONG_STATUSES.has(req.body.status) ? req.body.status : "published",
      created_at: now,
      updated_at: now,
    };
    db.songs.push(song);
    appendAuditLog(db, req, "create_song", "song", song.id, {
      title: song.title,
      artist: song.artist,
    });
    await saveDb(db);
    res.status(201).json(serializeSong(db, req, song));
  },
);

app.put(
  "/admin-api/songs/:id",
  requireAdminPermission("catalog"),
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
    if (!allowFeaturedChange(req, res, song.is_featured)) return;
    const uploadError = validateUploadSettings(db, req.files);
    if (uploadError) {
      return res.status(400).json({ detail: uploadError });
    }
    const audioUrl = mediaPath(req.body.audio_file) === `/api/songs/${song.id}/audio/`
      ? "" : audioInput(req.body.audio_file);
    if (audioUrl === null) return res.status(400).json({ detail: "Use an audio upload or a public HTTPS audio URL without credentials." });
    const genreData = Object.prototype.hasOwnProperty.call(req.body || {}, "genre")
      ? genrePayload(req, db)
      : { genre: song.genre, genre_note: song.genre_note || "" };
    Object.assign(song, {
      artist: Number(req.body.artist || song.artist),
      title: req.body.title || song.title,
      audio_file:
        (await uploadUrlFor(req.files?.audio_upload?.[0])) ||
        audioUrl ||
        song.audio_file,
      cover_image:
        (await uploadUrlFor(req.files?.cover_upload?.[0])) ||
        req.body.cover_image ||
        song.cover_image,
      genre: genreData.genre,
      genre_note: genreData.genre_note,
      lyrics: req.body.lyrics ?? song.lyrics,
      play_count: numberOrZero(req.body.play_count ?? song.play_count),
      release_date: req.body.release_date ?? song.release_date,
      is_featured: adminCan(req.adminUser, "discovery") ? boolValue(req.body.is_featured) : Boolean(song.is_featured),
      status: SONG_STATUSES.has(req.body.status) ? req.body.status : song.status || "published",
      updated_at: nowIso(),
    });
    appendAuditLog(db, req, "update_song", "song", song.id, {
      title: song.title,
      artist: song.artist,
    });
    await saveDb(db);
    res.json(serializeSong(db, req, song));
  },
);

app.delete("/admin-api/songs/:id", requireAdminPermission("catalog"), requirePermanentDeletePermission, async (req, res) => {
  const db = await loadDb();
  const id = Number(req.params.id);
  const song = db.songs.find((item) => Number(item.id) === id);
  if (!song) return res.status(404).json({ detail: "Song not found." });

  if (req.query?.confirm === "DELETE FOREVER") {
    db.songs = db.songs.filter((item) => Number(item.id) !== id);
    db.songLikes = db.songLikes.filter((like) => Number(like.song) !== id);
    appendAuditLog(db, req, "permanently_delete_song", "song", id, {
      reason: cleanText(req.body?.reason || "Permanent delete confirmed"),
    });
    await saveDb(db);
    return res.json({ deleted: true, permanent: true });
  }

  song.status = "removed";
  song.removed_at = nowIso();
  song.updated_at = song.removed_at;
  appendAuditLog(db, req, "remove_song", "song", song.id, {});
  await saveDb(db);
  res.json({ removed: true, song: serializeSong(db, req, song) });
});

app.post("/admin-api/songs/:id/hide", requireAdminPermission("catalog"), async (req, res) => {
  const db = await loadDb();
  const song = db.songs.find((item) => Number(item.id) === Number(req.params.id));
  if (!song) return res.status(404).json({ detail: "Song not found." });
  song.status = "hidden";
  song.updated_at = nowIso();
  appendAuditLog(db, req, "hide_song", "song", song.id, {});
  await saveDb(db);
  res.json(serializeSong(db, req, song));
});

app.post("/admin-api/songs/:id/restore", requireAdminPermission("catalog"), async (req, res) => {
  const db = await loadDb();
  const song = db.songs.find((item) => Number(item.id) === Number(req.params.id));
  if (!song) return res.status(404).json({ detail: "Song not found." });
  song.status = "published";
  song.removed_at = null;
  song.updated_at = nowIso();
  appendAuditLog(db, req, "restore_song", "song", song.id, {});
  await saveDb(db);
  res.json(serializeSong(db, req, song));
});

app.post("/admin-api/songs/:id/remove", requireAdminPermission("catalog"), async (req, res) => {
  const db = await loadDb();
  const song = db.songs.find((item) => Number(item.id) === Number(req.params.id));
  if (!song) return res.status(404).json({ detail: "Song not found." });
  const reason = cleanText(req.body?.reason);
  if (!reason) return res.status(400).json({ detail: "Enter a removal reason." });
  song.status = "removed";
  song.removal_reason = reason;
  song.removed_at = nowIso();
  song.updated_at = song.removed_at;
  appendAuditLog(db, req, "remove_song", "song", song.id, { reason });
  await saveDb(db);
  res.json(serializeSong(db, req, song));
});

app.post("/admin-api/songs/:id/feature", requireAdminPermission("discovery"), async (req, res) => {
  const db = await loadDb();
  const song = db.songs.find((item) => Number(item.id) === Number(req.params.id));
  if (!song) return res.status(404).json({ detail: "Song not found." });
  song.is_featured = true;
  song.updated_at = nowIso();
  appendAuditLog(db, req, "feature_song", "song", song.id, {});
  await saveDb(db);
  res.json(serializeSong(db, req, song));
});

app.post("/admin-api/songs/:id/unfeature", requireAdminPermission("discovery"), async (req, res) => {
  const db = await loadDb();
  const song = db.songs.find((item) => Number(item.id) === Number(req.params.id));
  if (!song) return res.status(404).json({ detail: "Song not found." });
  song.is_featured = false;
  song.updated_at = nowIso();
  appendAuditLog(db, req, "unfeature_song", "song", song.id, {});
  await saveDb(db);
  res.json(serializeSong(db, req, song));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error?.code === "STALE_WRITE") {
    return res.status(409).json({ detail: "This record changed while saving. Reload and try again." });
  }

  if (
    error instanceof multer.MulterError ||
    error?.message?.includes("Upload") ||
    error?.message?.includes("Unsupported upload field") ||
    error?.message?.includes("valid audio") ||
    error?.message?.includes("valid image") ||
    error?.message?.includes("valid support attachment")
  ) {
    return res.status(400).json({ detail: error.message });
  }

  console.error("Unhandled API error:", error);
  return res.status(500).json({ detail: "Something went wrong." });
});

await ensureDb();
// Publication is an explicit background job, never a side effect of a read.
// SQL row locks arbitrate multiple Render instances. Failures retry next tick.
const SCHEDULED_PUBLISHER_ENABLED = process.env.SCHEDULED_PUBLISHER_ENABLED === "true";
let publicationRunning = false;
async function runScheduledPublication() {
  if (!SCHEDULED_PUBLISHER_ENABLED || publicationRunning) return;
  publicationRunning = true;
  try {
    if (USE_SUPABASE_PERSISTENCE) await supabasePersistence.publishDueReleases();
    else {
      const db = await loadDb();
      if (publishDueReleases(db)) await saveDb(db);
    }
  } catch {
    console.error("Scheduled publication failed; will retry on the next worker tick.");
  } finally { publicationRunning = false; }
}
if (SCHEDULED_PUBLISHER_ENABLED) setInterval(runScheduledPublication, 60000).unref();
app.listen(PORT, "0.0.0.0", () => {
  if (SCHEDULED_PUBLISHER_ENABLED) void runScheduledPublication();
  console.log(`Teso Tunes JS backend running on http://0.0.0.0:${PORT}`);
  console.log(`Admin dashboard: http://127.0.0.1:${PORT}/admin/`);
});
