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

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/media", express.static(LEGACY_MEDIA_DIR));
app.use("/admin", express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", service: "teso-tunes-api" });
});

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
    await saveDb(seedDb());
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

function seedDb() {
  const createdAt = new Date().toISOString();
  const artists = [
    "Sparo UG",
    "Mr. Tablet UG",
    "Pana Boy",
    "Candy Man",
    "Simple Bullet",
    "Josh Rash",
  ].map((name, index) => ({
    id: index + 1,
    name,
    category: ["Rappers", "Other Secular Artists", "Gospel Artists"][index % 3],
    bio: `${name} carries the Teso sound forward with songs rooted in community, rhythm, faith, and everyday life.`,
    photo: `https://picsum.photos/seed/teso-artist-${index + 1}/600/600`,
    location: ["Soroti", "Kumi", "Ngora"][index % 3],
    is_featured: index < 4,
    created_at: createdAt,
  }));

  const songs = artists.flatMap((artist, artistIndex) =>
    ["Akogo Fire", "Teso Love"].map((title, songIndex) => ({
      id: artistIndex * 2 + songIndex + 1,
      artist: artist.id,
      title,
      audio_file: "",
      cover_image: `https://picsum.photos/seed/teso-song-${artist.id}-${songIndex + 1}/800/800`,
      genre: ["Teso Fusion", "Afrobeat", "Gospel"][songIndex % 3],
      lyrics: "",
      play_count: 1200 + artistIndex * 300 + songIndex * 80,
      release_date: "",
      is_featured: artist.is_featured && songIndex === 0,
      created_at: createdAt,
    })),
  );

  return {
    artists,
    songs,
    listeners: [],
    authTokens: [],
    songLikes: [],
    artistFollows: [],
    nextIds: {
      artist: artists.length + 1,
      listener: 1,
      song: songs.length + 1,
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
  next();
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

function createAuthSession(db, listener) {
  const token = crypto.randomBytes(32).toString("hex");
  db.authTokens.push({
    token_hash: hashToken(token),
    listener: listener.id,
    created_at: new Date().toISOString(),
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

app.get("/", (req, res) => {
  res.redirect("/admin/");
});

app.post("/api/auth/register/", async (req, res) => {
  const db = await loadDb();
  const name = cleanText(req.body?.name);
  const email = normalizeEmail(req.body?.email);
  const phone = normalizePhone(req.body?.phone);
  const password = String(req.body?.password || "");
  const deviceId = cleanText(req.body?.device_id);

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
    created_at: now,
    updated_at: now,
  };
  db.listeners.push(listener);
  attachDeviceEngagement(db, listener, deviceId);
  const token = createAuthSession(db, listener);
  await saveDb(db);
  res.status(201).json(authResponse(db, listener, token));
});

app.post("/api/auth/login/", async (req, res) => {
  const db = await loadDb();
  const identifier = cleanText(req.body?.identifier || req.body?.email || req.body?.phone);
  const password = String(req.body?.password || "");
  const deviceId = cleanText(req.body?.device_id);
  const listener = findListenerByIdentifier(db, identifier);

  if (!listener || !verifyPassword(password, listener.password_hash)) {
    return res.status(401).json({ detail: "Invalid login details." });
  }

  attachDeviceEngagement(db, listener, deviceId);
  const token = createAuthSession(db, listener);
  await saveDb(db);
  res.json(authResponse(db, listener, token));
});

app.get("/api/auth/me/", async (req, res) => {
  const db = await loadDb();
  const listener = findListenerByToken(db, req);
  if (!listener) {
    return res.status(401).json({ detail: "Login required." });
  }
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

app.get("/api/artists/", async (req, res) => {
  const db = await loadDb();
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
  const db = await loadDb();
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  res.json(serializeArtist(db, req, artist, true));
});

app.get("/api/songs/", async (req, res) => {
  const db = await loadDb();
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
  const db = await loadDb();
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
  const db = await loadDb();
  const song = db.songs.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  if (!song) return res.status(404).json({ detail: "Song not found." });
  res.json(serializeSong(db, req, song));
});

app.post("/api/songs/:id/play/", async (req, res) => {
  try {
    const db = await loadDb();
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
  const db = await loadDb();
  res.json(
    sortArtists(db.artists.filter((artist) => artist.is_featured)).map(
      (artist) => serializeArtist(db, req, artist),
    ),
  );
});

app.get("/api/featured-songs/", async (req, res) => {
  const db = await loadDb();
  res.json(
    sortSongs(db.songs.filter((song) => song.is_featured)).map((song) =>
      serializeSong(db, req, song),
    ),
  );
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

app.get("/admin-api/artists", requireAdmin, async (req, res) => {
  const db = await loadDb();
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
  const db = await loadDb();
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
      genre: req.body.genre || "",
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
      genre: req.body.genre ?? song.genre,
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

await ensureDb();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Teso Tunes JS backend running on http://0.0.0.0:${PORT}`);
  console.log(`Admin dashboard: http://127.0.0.1:${PORT}/admin/`);
});
