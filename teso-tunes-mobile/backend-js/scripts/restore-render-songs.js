import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const backendJsRoot = path.resolve(__dirname, "..");
const dbPath = path.join(backendJsRoot, "data", "db.json");
const remoteBaseUrl = (process.env.RENDER_BASE_URL || "https://teso-music-app.onrender.com").replace(/\/+$/, "");
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "TesoAdmin@2026";
const requestTimeoutMs = Number(process.env.RESTORE_TIMEOUT_MS || 10 * 60 * 1000);

function publicUrl(pathname) {
  if (!pathname) return "";
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${remoteBaseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function songKey(song) {
  return `${normalize(song.title)}::${normalize(song.artist_name)}`;
}

function resolveLocalAsset(value) {
  if (!value || /^https?:\/\//i.test(value)) return "";
  const normalized = value.replace(/\\/g, "/");

  if (normalized.startsWith("/uploads/")) {
    return path.join(backendJsRoot, normalized.slice(1));
  }

  if (normalized.startsWith("/media/")) {
    return path.join(repoRoot, "backend", normalized.slice(1));
  }

  return "";
}

async function existingFile(value) {
  const filePath = resolveLocalAsset(value);
  if (!filePath) return "";

  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? filePath : "";
  } catch (error) {
    return "";
  }
}

async function appendFile(formData, field, filePath) {
  const buffer = await fs.readFile(filePath);
  const filename = path.basename(filePath);
  const extension = path.extname(filename).toLowerCase();
  const type =
    extension === ".png"
      ? "image/png"
      : extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : "audio/mpeg";
  formData.append(field, new Blob([buffer], { type }), filename);
  return buffer.length;
}

async function request(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${remoteBaseUrl}${pathname}`, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${text}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithRetry(label, pathname, options = {}, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request(pathname, options);
    } catch (error) {
      lastError = error;
      console.warn(`${label} attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
      }
    }
  }

  throw lastError;
}

async function main() {
  const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
  const login = await request("/admin-api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  const authHeaders = { authorization: `Bearer ${login.token}` };
  const [remoteArtists, remoteSongs] = await Promise.all([
    request("/admin-api/artists", { headers: authHeaders }),
    request("/admin-api/songs", { headers: authHeaders }),
  ]);
  const artistByName = new Map(remoteArtists.map((artist) => [normalize(artist.name), artist]));
  const localArtistById = new Map(db.artists.map((artist) => [Number(artist.id), artist]));
  const existingSongKeys = new Set(remoteSongs.map(songKey));
  const existingSongTitles = new Set(remoteSongs.map((song) => normalize(song.title)));
  const failedSongs = [];
  let restored = 0;
  let skipped = 0;

  console.log(`Remote currently has ${remoteArtists.length} artists and ${remoteSongs.length} songs.`);

  for (const [index, song] of db.songs.entries()) {
    const key = songKey(song);
    const titleKey = normalize(song.title);
    if (existingSongKeys.has(key) || existingSongTitles.has(titleKey)) {
      skipped += 1;
      console.log(`[${index + 1}/${db.songs.length}] skip ${song.title}`);
      continue;
    }

    const localArtist = localArtistById.get(Number(song.artist));
    const remoteArtist = artistByName.get(normalize(localArtist?.name));
    if (!remoteArtist) {
      failedSongs.push({ id: song.id, reason: `artist not found: ${localArtist?.name || song.artist}` });
      continue;
    }

    const formData = new FormData();
    formData.append("artist", String(remoteArtist.id));
    formData.append("title", song.title || "Untitled Song");
    formData.append("audio_file", publicUrl(song.audio_file));
    formData.append("cover_image", publicUrl(song.cover_image));
    formData.append("genre", song.genre || "");
    formData.append("lyrics", song.lyrics || "");
    formData.append("play_count", String(song.play_count || 0));
    formData.append("release_date", song.release_date || "");
    formData.append("is_featured", song.is_featured ? "true" : "false");

    const audioFile = await existingFile(song.audio_file);
    const coverFile = await existingFile(song.cover_image);
    let audioBytes = 0;
    if (audioFile) audioBytes = await appendFile(formData, "audio_upload", audioFile);
    if (coverFile) await appendFile(formData, "cover_upload", coverFile);

    const label = `[${index + 1}/${db.songs.length}] ${song.title}`;
    console.log(`${label} uploading ${audioBytes ? `${(audioBytes / 1048576).toFixed(2)} MB` : "metadata only"}`);

    try {
      const created = await requestWithRetry(label, "/admin-api/songs", {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });
      existingSongKeys.add(songKey(created));
      existingSongTitles.add(normalize(created.title));
      restored += 1;
      console.log(`${label} restored as remote song ${created.id}`);
    } catch (error) {
      failedSongs.push({ id: song.id, title: song.title, reason: error.message });
      console.error(`${label} failed after retries.`);
    }
  }

  const publicSongs = await request("/api/songs/");
  console.log(
    JSON.stringify(
      {
        failedSongs,
        publicSongs: publicSongs.length,
        remoteBaseUrl,
        restored,
        skipped,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
