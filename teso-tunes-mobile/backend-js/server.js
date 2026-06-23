import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const LEGACY_MEDIA_DIR = path.join(__dirname, "..", "backend", "media");
const PORT = Number(process.env.PORT || 8000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "TesoAdmin@2026";
const ADMIN_TOKEN =
  process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString("hex");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/media", express.static(LEGACY_MEDIA_DIR));
app.use("/admin", express.static(path.join(__dirname, "public")));

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
  return JSON.parse(raw);
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
      audio_file:
        "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
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
    songLikes: [],
    artistFollows: [],
    nextIds: {
      artist: artists.length + 1,
      song: songs.length + 1,
    },
  };
}

function absoluteUrl(req, value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const base = `${req.protocol}://${req.get("host")}`;
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

app.get("/", (req, res) => {
  res.redirect("/admin/");
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
  const deviceId = getDeviceId(req);
  if (!song) return res.status(404).json({ detail: "Song not found." });
  if (!deviceId)
    return res.status(400).json({ detail: "device_id is required." });
  const exists = db.songLikes.some(
    (like) =>
      Number(like.song) === Number(song.id) && like.device_id === deviceId,
  );
  if (!exists) {
    db.songLikes.push({
      song: song.id,
      device_id: deviceId,
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
  const deviceId = getDeviceId(req);
  if (!song) return res.status(404).json({ detail: "Song not found." });
  if (!deviceId)
    return res.status(400).json({ detail: "device_id is required." });
  db.songLikes = db.songLikes.filter(
    (like) =>
      !(Number(like.song) === Number(song.id) && like.device_id === deviceId),
  );
  await saveDb(db);
  res.json({ liked: false, like_count: likeCount(db, song.id) });
});

app.post("/api/artists/:id/follow/", async (req, res) => {
  const db = await loadDb();
  const artist = db.artists.find(
    (item) => Number(item.id) === Number(req.params.id),
  );
  const deviceId = getDeviceId(req);
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  if (!deviceId)
    return res.status(400).json({ detail: "device_id is required." });
  const exists = db.artistFollows.some(
    (follow) =>
      Number(follow.artist) === Number(artist.id) &&
      follow.device_id === deviceId,
  );
  if (!exists) {
    db.artistFollows.push({
      artist: artist.id,
      device_id: deviceId,
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
  const deviceId = getDeviceId(req);
  if (!artist) return res.status(404).json({ detail: "Artist not found." });
  if (!deviceId)
    return res.status(400).json({ detail: "device_id is required." });
  db.artistFollows = db.artistFollows.filter(
    (follow) =>
      !(
        Number(follow.artist) === Number(artist.id) &&
        follow.device_id === deviceId
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
