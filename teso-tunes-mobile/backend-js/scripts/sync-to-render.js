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

function publicUrl(pathname) {
  if (!pathname) return "";
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${remoteBaseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
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
  const type = extension === ".png"
    ? "image/png"
    : extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : "audio/mpeg";
  formData.append(field, new Blob([buffer], { type }), filename);
}

async function request(pathname, options = {}) {
  const response = await fetch(`${remoteBaseUrl}${pathname}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${text}`);
  }

  return data;
}

async function main() {
  const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
  const login = await request("/admin-api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  const authHeaders = { authorization: `Bearer ${login.token}` };

  const remoteSongs = await request("/admin-api/songs", { headers: authHeaders });
  for (const song of remoteSongs) {
    await request(`/admin-api/songs/${song.id}?confirm=DELETE%20FOREVER`, {
      method: "DELETE",
      headers: authHeaders,
    });
  }

  const remoteArtists = await request("/admin-api/artists", { headers: authHeaders });
  for (const artist of remoteArtists) {
    await request(`/admin-api/artists/${artist.id}?confirm=DELETE%20FOREVER`, {
      method: "DELETE",
      headers: authHeaders,
    });
  }

  const artistIdMap = new Map();
  for (const artist of db.artists) {
    const formData = new FormData();
    formData.append("name", artist.name || "Untitled Artist");
    formData.append("category", artist.category || "Other Secular Artists");
    formData.append("bio", artist.bio || "");
    formData.append("photo", publicUrl(artist.photo));
    formData.append("location", artist.location || "");
    formData.append("is_featured", artist.is_featured ? "true" : "false");

    const photoFile = await existingFile(artist.photo);
    if (photoFile) await appendFile(formData, "photo_file", photoFile);

    const created = await request("/admin-api/artists", {
      method: "POST",
      headers: authHeaders,
      body: formData,
    });
    artistIdMap.set(Number(artist.id), Number(created.id));
  }

  let uploadedAudioCount = 0;
  for (const song of db.songs) {
    const formData = new FormData();
    const nextArtistId = artistIdMap.get(Number(song.artist));
    formData.append("artist", String(nextArtistId || song.artist));
    formData.append("title", song.title || "Untitled Song");
    formData.append("audio_file", publicUrl(song.audio_file));
    formData.append("cover_image", publicUrl(song.cover_image));
    formData.append("genre", song.genre || "");
    formData.append("lyrics", song.lyrics || "");
    formData.append("play_count", String(song.play_count || 0));
    formData.append("release_date", song.release_date || "");
    formData.append("is_featured", song.is_featured ? "true" : "false");

    const audioFile = await existingFile(song.audio_file);
    if (audioFile) {
      await appendFile(formData, "audio_upload", audioFile);
      uploadedAudioCount += 1;
    }

    const coverFile = await existingFile(song.cover_image);
    if (coverFile) await appendFile(formData, "cover_upload", coverFile);

    await request("/admin-api/songs", {
      method: "POST",
      headers: authHeaders,
      body: formData,
    });
  }

  console.log(
    JSON.stringify(
      {
        artists: db.artists.length,
        songs: db.songs.length,
        uploadedAudio: uploadedAudioCount,
        remoteBaseUrl,
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
