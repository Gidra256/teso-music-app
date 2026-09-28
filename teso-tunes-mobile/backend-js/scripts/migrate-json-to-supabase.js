import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");
const storageRoot = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : backendRoot;

const config = {
  databaseUrl: process.env.DATABASE_URL || "",
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || "",
  audioBucket: process.env.SUPABASE_AUDIO_BUCKET || "music-audio",
  artworkBucket: process.env.SUPABASE_ARTWORK_BUCKET || "artwork",
  avatarBucket: process.env.SUPABASE_AVATAR_BUCKET || "avatars",
  legacyDbPath:
    process.env.LEGACY_DB_PATH || path.join(storageRoot, "data", "db.json"),
  legacyUploadsDir:
    process.env.LEGACY_UPLOADS_DIR || path.join(storageRoot, "uploads"),
  legacyMediaDir:
    process.env.LEGACY_MEDIA_DIR || path.join(repoRoot, "backend", "media"),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "https://teso-music-app.onrender.com").replace(
    /\/+$/,
    "",
  ),
  sourceName: process.env.MIGRATION_SOURCE_NAME || "legacy-json",
  dryRun: process.env.DRY_RUN === "1" || process.argv.includes("--dry-run"),
};

const requiredEnv = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length && !config.dryRun) {
  console.error(`Missing required env vars: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const summary = {
  counts: {},
  demoRecords: [],
  failedMedia: [],
  migratedMedia: [],
  skippedMedia: [],
  upserts: {},
};

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value) {
  return String(value || "").trim();
}

function nullableText(value) {
  const clean = cleanText(value);
  return clean || null;
}

function parseTimestamp(value) {
  const clean = cleanText(value);
  return clean ? clean : null;
}

function parseDate(value) {
  const clean = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function boolValue(value) {
  return value === true || value === "true" || value === "on" || value === "1";
}

function isDemoArtwork(value) {
  return /picsum\.photos/i.test(String(value || ""));
}

function extensionFor(value, fallback = "") {
  const pathname = (() => {
    try {
      return new URL(value).pathname;
    } catch {
      return value;
    }
  })();
  const extension = path.extname(String(pathname || "")).toLowerCase();
  return extension || fallback;
}

function mimeFor(value, mediaKind) {
  const extension = extensionFor(value).replace(/^\./, "");
  if (mediaKind === "audio") {
    if (extension === "m4a") return "audio/mp4";
    if (extension === "aac") return "audio/aac";
    if (extension === "flac") return "audio/flac";
    if (extension === "ogg") return "audio/ogg";
    if (extension === "opus") return "audio/opus";
    if (extension === "wav") return "audio/wav";
    if (extension === "webm") return "audio/webm";
    return "audio/mpeg";
  }
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

function localPathForLegacyValue(value) {
  const clean = cleanText(value).replace(/\\/g, "/");
  if (clean.startsWith("/uploads/")) {
    return path.join(config.legacyUploadsDir, clean.slice("/uploads/".length));
  }
  if (clean.startsWith("/media/")) {
    return path.join(config.legacyMediaDir, clean.slice("/media/".length));
  }
  if (/^https?:\/\//i.test(clean)) {
    try {
      const url = new URL(clean);
      if (url.pathname.startsWith("/uploads/")) {
        return path.join(config.legacyUploadsDir, url.pathname.slice("/uploads/".length));
      }
      if (url.pathname.startsWith("/media/")) {
        return path.join(config.legacyMediaDir, url.pathname.slice("/media/".length));
      }
    } catch {}
  }
  return "";
}

function remoteUrlForLegacyValue(value) {
  const clean = cleanText(value);
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  if (clean.startsWith("/uploads/") || clean.startsWith("/media/")) {
    return `${config.publicBaseUrl}${clean}`;
  }
  return "";
}

async function readLegacyMedia(value) {
  const localPath = localPathForLegacyValue(value);
  if (localPath) {
    try {
      const buffer = await fs.readFile(localPath);
      return { buffer, sourceKind: "local-file" };
    } catch {}
  }

  const remoteUrl = remoteUrlForLegacyValue(value);
  if (!remoteUrl) return null;
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`fetch ${remoteUrl} failed: ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    sourceKind: "remote-url",
  };
}

async function storageMap(client, legacyValue) {
  if (config.dryRun || !legacyValue) return null;
  const result = await client.query(
    "select bucket, object_path from public.legacy_media_migrations where legacy_value = $1",
    [legacyValue],
  );
  return result.rows[0] || null;
}

async function uploadStorageObject({ bucket, objectPath, buffer, contentType }) {
  if (config.dryRun) return;
  const encodedPath = objectPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`,
    {
      method: "PUT",
      headers: {
        apikey: config.supabaseSecretKey,
        authorization: `Bearer ${config.supabaseSecretKey}`,
        "cache-control": "3600",
        "content-type": contentType,
        "x-upsert": "true",
      },
      body: buffer,
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`storage upload failed ${bucket}/${objectPath}: ${response.status} ${text}`);
  }
}

async function migrateMedia(client, { legacyValue, bucket, objectPath, mediaKind, owner }) {
  const clean = cleanText(legacyValue);
  if (!clean) return { objectPath: null, legacyValue: "" };

  if (isDemoArtwork(clean)) {
    summary.demoRecords.push({ owner, value: clean });
    return { objectPath: null, legacyValue: clean };
  }

  const existing = await storageMap(client, clean);
  if (existing) {
    summary.skippedMedia.push({ owner, reason: "already_migrated", value: clean });
    return { objectPath: existing.object_path, legacyValue: clean };
  }

  try {
    const file = await readLegacyMedia(clean);
    if (!file) {
      summary.failedMedia.push({ owner, reason: "not_found", value: clean });
      return { objectPath: null, legacyValue: clean };
    }

    const contentType = mimeFor(clean, mediaKind);
    await uploadStorageObject({ bucket, objectPath, buffer: file.buffer, contentType });

    if (!config.dryRun) {
      await client.query(
        `insert into public.legacy_media_migrations
          (legacy_value, bucket, object_path, source_kind, bytes, content_type)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (legacy_value) do update set
          bucket = excluded.bucket,
          object_path = excluded.object_path,
          source_kind = excluded.source_kind,
          bytes = excluded.bytes,
          content_type = excluded.content_type,
          migrated_at = now()`,
        [clean, bucket, objectPath, file.sourceKind, file.buffer.length, contentType],
      );
    }

    summary.migratedMedia.push({
      owner,
      bucket,
      objectPath,
      bytes: file.buffer.length,
      dryRun: config.dryRun,
      sourceKind: file.sourceKind,
    });
    return { objectPath, legacyValue: clean };
  } catch (error) {
    summary.failedMedia.push({ owner, reason: error.message, value: clean });
    return { objectPath: null, legacyValue: clean };
  }
}

function increment(name) {
  summary.upserts[name] = (summary.upserts[name] || 0) + 1;
}

async function query(client, sql, params = []) {
  if (config.dryRun) return { rows: [] };
  return client.query(sql, params);
}

async function upsertListener(client, item) {
  await query(
    client,
    `insert into public.listeners
      (id, name, email, phone, password_hash, role, plan, status, artist_id,
       artist_application_id, suspension_reason, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (id) do update set
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      password_hash = excluded.password_hash,
      role = excluded.role,
      plan = excluded.plan,
      status = excluded.status,
      artist_id = excluded.artist_id,
      artist_application_id = excluded.artist_application_id,
      suspension_reason = excluded.suspension_reason,
      updated_at = excluded.updated_at`,
    [
      item.id,
      item.name || "",
      item.email || "",
      item.phone || "",
      item.password_hash || "",
      item.role || "listener",
      item.plan || "free",
      item.status || "active",
      numberOrNull(item.artist_id),
      numberOrNull(item.artist_application_id),
      item.suspension_reason || "",
      parseTimestamp(item.created_at) || nowIso(),
      parseTimestamp(item.updated_at),
    ],
  );
  increment("listeners");
}

async function upsertArtist(client, item, photoPath) {
  await query(
    client,
    `insert into public.artists
      (id, name, category, bio, photo_path, legacy_photo, location, is_featured,
       status, owner_listener_id, source_application_id, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (id) do update set
      name = excluded.name,
      category = excluded.category,
      bio = excluded.bio,
      photo_path = excluded.photo_path,
      legacy_photo = excluded.legacy_photo,
      location = excluded.location,
      is_featured = excluded.is_featured,
      status = excluded.status,
      owner_listener_id = excluded.owner_listener_id,
      source_application_id = excluded.source_application_id,
      updated_at = excluded.updated_at`,
    [
      item.id,
      item.name || "Untitled Artist",
      item.category || "",
      item.bio || "",
      photoPath,
      item.photo || "",
      item.location || "",
      Boolean(item.is_featured),
      item.status || "active",
      numberOrNull(item.owner_listener),
      numberOrNull(item.source_application_id),
      parseTimestamp(item.created_at) || nowIso(),
      parseTimestamp(item.updated_at),
    ],
  );
  increment("artists");
}

async function upsertSong(client, item, audioPath, coverPath) {
  await query(
    client,
    `insert into public.songs
      (id, artist_id, title, audio_path, legacy_audio_file, cover_path, legacy_cover_image,
       genre, genre_note, lyrics, play_count, release_date, is_featured, status,
       source_release_id, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict (id) do update set
      artist_id = excluded.artist_id,
      title = excluded.title,
      audio_path = excluded.audio_path,
      legacy_audio_file = excluded.legacy_audio_file,
      cover_path = excluded.cover_path,
      legacy_cover_image = excluded.legacy_cover_image,
      genre = excluded.genre,
      genre_note = excluded.genre_note,
      lyrics = excluded.lyrics,
      play_count = excluded.play_count,
      release_date = excluded.release_date,
      is_featured = excluded.is_featured,
      status = excluded.status,
      source_release_id = excluded.source_release_id,
      updated_at = excluded.updated_at`,
    [
      item.id,
      item.artist,
      item.title || "Untitled Song",
      audioPath,
      item.audio_file || "",
      coverPath,
      item.cover_image || "",
      item.genre || "",
      item.genre_note || "",
      item.lyrics || "",
      Math.max(0, Number(item.play_count || 0)),
      parseDate(item.release_date),
      Boolean(item.is_featured),
      item.status || "published",
      numberOrNull(item.source_release_id),
      parseTimestamp(item.created_at) || nowIso(),
      parseTimestamp(item.updated_at),
    ],
  );
  increment("songs");
}

async function upsertGenre(client, item) {
  await query(
    client,
    `insert into public.genres (id, name, active, position, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (id) do update set
      name = excluded.name,
      active = excluded.active,
      position = excluded.position,
      updated_at = excluded.updated_at`,
    [
      item.id,
      item.name,
      item.active !== false,
      Number(item.position || 0),
      parseTimestamp(item.created_at) || nowIso(),
      parseTimestamp(item.updated_at),
    ],
  );
  increment("genres");
}

async function upsertApplication(client, item, photoPath) {
  await query(
    client,
    `insert into public.artist_applications
      (id, listener_id, artist_id, artist_name, contact_name, bio, country, region,
       genre, genre_note, phone, email, photo_path, legacy_photo, social_link,
       genuine_confirmed, status, review_reason, rejection_reason, reviewed_by,
       reviewed_at, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     on conflict (id) do update set
      listener_id = excluded.listener_id,
      artist_id = excluded.artist_id,
      artist_name = excluded.artist_name,
      contact_name = excluded.contact_name,
      bio = excluded.bio,
      country = excluded.country,
      region = excluded.region,
      genre = excluded.genre,
      genre_note = excluded.genre_note,
      phone = excluded.phone,
      email = excluded.email,
      photo_path = excluded.photo_path,
      legacy_photo = excluded.legacy_photo,
      social_link = excluded.social_link,
      genuine_confirmed = excluded.genuine_confirmed,
      status = excluded.status,
      review_reason = excluded.review_reason,
      rejection_reason = excluded.rejection_reason,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at,
      updated_at = excluded.updated_at`,
    [
      item.id,
      item.listener,
      numberOrNull(item.artist),
      item.artist_name || "",
      item.contact_name || "",
      item.bio || "",
      item.country || "",
      item.region || "",
      item.genre || "",
      item.genre_note || "",
      item.phone || "",
      item.email || "",
      photoPath,
      item.photo || "",
      item.social_link || "",
      Boolean(item.genuine_confirmed),
      item.status || "pending",
      item.review_reason || "",
      item.rejection_reason || "",
      item.reviewed_by || "",
      parseTimestamp(item.reviewed_at),
      parseTimestamp(item.created_at) || nowIso(),
      parseTimestamp(item.updated_at),
    ],
  );
  increment("artist_applications");
}

async function upsertRelease(client, item, audioPath, coverPath) {
  await query(
    client,
    `insert into public.releases
      (id, artist_id, listener_id, title, release_type, featured_artist, genre,
       genre_note, language, release_date, explicit, producer, songwriter,
       description, rights_confirmed, audio_path, legacy_audio_file, cover_path,
       legacy_cover_image, status, rejection_reason, review_reason, public_song_id,
       submitted_at, approved_at, published_at, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
     on conflict (id) do update set
      artist_id = excluded.artist_id,
      listener_id = excluded.listener_id,
      title = excluded.title,
      release_type = excluded.release_type,
      featured_artist = excluded.featured_artist,
      genre = excluded.genre,
      genre_note = excluded.genre_note,
      language = excluded.language,
      release_date = excluded.release_date,
      explicit = excluded.explicit,
      producer = excluded.producer,
      songwriter = excluded.songwriter,
      description = excluded.description,
      rights_confirmed = excluded.rights_confirmed,
      audio_path = excluded.audio_path,
      legacy_audio_file = excluded.legacy_audio_file,
      cover_path = excluded.cover_path,
      legacy_cover_image = excluded.legacy_cover_image,
      status = excluded.status,
      rejection_reason = excluded.rejection_reason,
      review_reason = excluded.review_reason,
      public_song_id = excluded.public_song_id,
      submitted_at = excluded.submitted_at,
      approved_at = excluded.approved_at,
      published_at = excluded.published_at,
      updated_at = excluded.updated_at`,
    [
      item.id,
      numberOrNull(item.artist),
      numberOrNull(item.listener),
      item.title || "",
      item.release_type || "Single",
      item.featured_artist || "",
      item.genre || "",
      item.genre_note || "",
      item.language || "",
      parseDate(item.release_date),
      Boolean(item.explicit),
      item.producer || "",
      item.songwriter || "",
      item.description || "",
      Boolean(item.rights_confirmed),
      audioPath,
      item.audio_file || "",
      coverPath,
      item.cover_image || "",
      item.status || "draft",
      item.rejection_reason || "",
      item.review_reason || "",
      numberOrNull(item.public_song),
      parseTimestamp(item.submitted_at),
      parseTimestamp(item.approved_at),
      parseTimestamp(item.published_at),
      parseTimestamp(item.created_at) || nowIso(),
      parseTimestamp(item.updated_at),
    ],
  );
  increment("releases");
}

async function upsertSimpleRows(client, db) {
  for (const session of db.authTokens || []) {
    await query(
      client,
      `insert into public.auth_tokens
        (id, listener_id, token_hash, device_id, device_name, created_at, last_active_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set
        listener_id = excluded.listener_id,
        token_hash = excluded.token_hash,
        device_id = excluded.device_id,
        device_name = excluded.device_name,
        last_active_at = excluded.last_active_at`,
      [
        session.id || crypto.randomUUID(),
        session.listener,
        session.token_hash,
        session.device_id || "",
        session.device_name || "",
        parseTimestamp(session.created_at) || nowIso(),
        parseTimestamp(session.last_active_at),
      ],
    );
    increment("auth_tokens");
  }

  for (const like of db.songLikes || []) {
    await query(
      client,
      `insert into public.song_likes (song_id, listener_id, device_id, created_at)
       values ($1,$2,$3,$4)
       on conflict do nothing`,
      [
        like.song,
        numberOrNull(like.listener),
        like.device_id || "",
        parseTimestamp(like.created_at) || nowIso(),
      ],
    );
    increment("song_likes");
  }

  for (const follow of db.artistFollows || []) {
    await query(
      client,
      `insert into public.artist_follows (artist_id, listener_id, device_id, created_at)
       values ($1,$2,$3,$4)
       on conflict do nothing`,
      [
        follow.artist,
        numberOrNull(follow.listener),
        follow.device_id || "",
        parseTimestamp(follow.created_at) || nowIso(),
      ],
    );
    increment("artist_follows");
  }

  for (const playlist of db.playlists || []) {
    const artwork = await migrateMedia(client, {
      legacyValue: playlist.artwork,
      bucket: config.artworkBucket,
      objectPath: `playlists/${playlist.id}/artwork${extensionFor(playlist.artwork, ".jpg")}`,
      mediaKind: "image",
      owner: `playlist:${playlist.id}:artwork`,
    });
    await query(
      client,
      `insert into public.playlists
        (id, owner_id, name, description, artwork_path, legacy_artwork, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set
        owner_id = excluded.owner_id,
        name = excluded.name,
        description = excluded.description,
        artwork_path = excluded.artwork_path,
        legacy_artwork = excluded.legacy_artwork,
        updated_at = excluded.updated_at`,
      [
        playlist.id,
        playlist.owner,
        playlist.name || "Untitled Playlist",
        playlist.description || "",
        artwork.objectPath,
        playlist.artwork || "",
        parseTimestamp(playlist.created_at) || nowIso(),
        parseTimestamp(playlist.updated_at),
      ],
    );
    increment("playlists");
  }

  for (const entry of db.playlistSongs || []) {
    await query(
      client,
      `insert into public.playlist_songs (playlist_id, song_id, position, added_at)
       values ($1,$2,$3,$4)
       on conflict (playlist_id, song_id) do update set
        position = excluded.position,
        added_at = excluded.added_at`,
      [
        entry.playlist,
        entry.song,
        Number(entry.position || 0),
        parseTimestamp(entry.added_at) || nowIso(),
      ],
    );
    increment("playlist_songs");
  }

  for (const report of db.reports || []) {
    await query(
      client,
      `insert into public.reports
        (id, reporter_id, target_type, target_id, reason, status, notes, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set
        reporter_id = excluded.reporter_id,
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        reason = excluded.reason,
        status = excluded.status,
        notes = excluded.notes,
        updated_at = excluded.updated_at`,
      [
        report.id,
        numberOrNull(report.reporter),
        report.target_type || "content",
        numberOrNull(report.target_id),
        report.reason || "",
        report.status || "open",
        report.notes || "",
        parseTimestamp(report.created_at) || nowIso(),
        parseTimestamp(report.updated_at),
      ],
    );
    increment("reports");
  }

  const settings = db.platformSettings || {};
  await query(
    client,
    `insert into public.platform_settings
      (id, registration_enabled, artist_applications_enabled, music_uploads_enabled,
       maintenance_mode, maintenance_message, max_audio_upload_mb, max_artwork_upload_mb,
       supported_audio_formats, minimum_supported_app_version, app_announcement,
       updated_by, updated_at)
     values (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (id) do update set
      registration_enabled = excluded.registration_enabled,
      artist_applications_enabled = excluded.artist_applications_enabled,
      music_uploads_enabled = excluded.music_uploads_enabled,
      maintenance_mode = excluded.maintenance_mode,
      maintenance_message = excluded.maintenance_message,
      max_audio_upload_mb = excluded.max_audio_upload_mb,
      max_artwork_upload_mb = excluded.max_artwork_upload_mb,
      supported_audio_formats = excluded.supported_audio_formats,
      minimum_supported_app_version = excluded.minimum_supported_app_version,
      app_announcement = excluded.app_announcement,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at`,
    [
      settings.registration_enabled !== false,
      settings.artist_applications_enabled !== false,
      settings.music_uploads_enabled !== false,
      Boolean(settings.maintenance_mode),
      settings.maintenance_message || "TesoHub Music is temporarily under maintenance.",
      Number(settings.max_audio_upload_mb || 80),
      Number(settings.max_artwork_upload_mb || 10),
      settings.supported_audio_formats || ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "webm"],
      settings.minimum_supported_app_version || "",
      settings.app_announcement || "",
      settings.updated_by || "",
      parseTimestamp(settings.updated_at),
    ],
  );
  increment("platform_settings");

  const flags = settings.feature_flags || {};
  for (const [key, enabled] of Object.entries(flags)) {
    await query(
      client,
      `insert into public.feature_flags (key, enabled, updated_at)
       values ($1,$2,now())
       on conflict (key) do update set enabled = excluded.enabled, updated_at = excluded.updated_at`,
      [key, Boolean(enabled)],
    );
    increment("feature_flags");
  }

  for (const entry of db.adminAuditLogs || []) {
    await query(
      client,
      `insert into public.admin_audit_logs
        (id, admin_user, admin_role, action, target_type, target_id, details, reason, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set
        admin_user = excluded.admin_user,
        admin_role = excluded.admin_role,
        action = excluded.action,
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        details = excluded.details,
        reason = excluded.reason`,
      [
        entry.id,
        entry.admin_user || "admin",
        entry.admin_role || "super_admin",
        entry.action || "admin_action",
        entry.target_type || "system",
        numberOrNull(entry.target_id),
        entry.details || {},
        entry.reason || "",
        parseTimestamp(entry.created_at) || nowIso(),
      ],
    );
    increment("admin_audit_logs");
  }
}

async function resetSequence(client, table, idColumn = "id") {
  if (config.dryRun) return;
  await client.query(
    `select setval(
      pg_get_serial_sequence($1, $2),
      greatest(coalesce((select max(${idColumn}) from ${table}), 0) + 1, 1),
      false
    )`,
    [table, idColumn],
  );
}

async function resetSequences(client) {
  const tables = [
    "public.listeners",
    "public.artists",
    "public.genres",
    "public.artist_applications",
    "public.songs",
    "public.releases",
    "public.song_likes",
    "public.artist_follows",
    "public.playlists",
    "public.playlist_songs",
    "public.reports",
    "public.admin_audit_logs",
    "public.listening_history",
  ];
  for (const table of tables) {
    await resetSequence(client, table);
  }
}

function countRecords(db) {
  for (const key of [
    "listeners",
    "authTokens",
    "artists",
    "songs",
    "songLikes",
    "artistFollows",
    "playlists",
    "playlistSongs",
    "artistApplications",
    "releases",
    "reports",
    "genres",
    "adminAuditLogs",
  ]) {
    summary.counts[key] = Array.isArray(db[key]) ? db[key].length : 0;
  }
  summary.counts.platformSettings = db.platformSettings ? 1 : 0;
}

async function main() {
  const startedAt = nowIso();
  const raw = await fs.readFile(config.legacyDbPath, "utf8");
  const db = JSON.parse(raw);
  countRecords(db);
  const fingerprint = crypto.createHash("sha256").update(raw).digest("hex");

  console.log(`Migrating ${config.legacyDbPath}`);
  console.log(`Source fingerprint: ${fingerprint}`);
  if (config.dryRun) {
    console.log("DRY_RUN=1: no database or storage writes will be performed.");
  }

  const client = new Client({
    connectionString: config.databaseUrl || "postgresql://dry-run",
    ssl: config.databaseUrl && !/localhost|127\.0\.0\.1/.test(config.databaseUrl)
      ? { rejectUnauthorized: false }
      : undefined,
  });

  if (!config.dryRun) {
    await client.connect();
    await client.query("begin");
  }

  try {
    for (const genre of db.genres || []) {
      await upsertGenre(client, genre);
    }

    for (const listener of db.listeners || []) {
      await upsertListener(client, listener);
    }

    for (const artist of db.artists || []) {
      const photo = await migrateMedia(client, {
        legacyValue: artist.photo,
        bucket: config.avatarBucket,
        objectPath: `artists/${artist.id}/profile${extensionFor(artist.photo, ".jpg")}`,
        mediaKind: "image",
        owner: `artist:${artist.id}:photo`,
      });
      await upsertArtist(client, artist, photo.objectPath);
    }

    for (const application of db.artistApplications || []) {
      const photo = await migrateMedia(client, {
        legacyValue: application.photo,
        bucket: config.avatarBucket,
        objectPath: `artist-applications/${application.id}/profile${extensionFor(application.photo, ".jpg")}`,
        mediaKind: "image",
        owner: `artist_application:${application.id}:photo`,
      });
      await upsertApplication(client, application, photo.objectPath);
    }

    for (const song of db.songs || []) {
      const audio = await migrateMedia(client, {
        legacyValue: song.audio_file,
        bucket: config.audioBucket,
        objectPath: `artists/${song.artist}/songs/${song.id}/audio${extensionFor(song.audio_file, ".mp3")}`,
        mediaKind: "audio",
        owner: `song:${song.id}:audio`,
      });
      const cover = await migrateMedia(client, {
        legacyValue: song.cover_image,
        bucket: config.artworkBucket,
        objectPath: `artists/${song.artist}/songs/${song.id}/cover${extensionFor(song.cover_image, ".jpg")}`,
        mediaKind: "image",
        owner: `song:${song.id}:cover`,
      });
      await upsertSong(client, song, audio.objectPath, cover.objectPath);
    }

    for (const release of db.releases || []) {
      const audio = await migrateMedia(client, {
        legacyValue: release.audio_file,
        bucket: config.audioBucket,
        objectPath: `artists/${release.artist}/releases/${release.id}/audio${extensionFor(release.audio_file, ".mp3")}`,
        mediaKind: "audio",
        owner: `release:${release.id}:audio`,
      });
      const cover = await migrateMedia(client, {
        legacyValue: release.cover_image,
        bucket: config.artworkBucket,
        objectPath: `artists/${release.artist}/releases/${release.id}/cover${extensionFor(release.cover_image, ".jpg")}`,
        mediaKind: "image",
        owner: `release:${release.id}:cover`,
      });
      await upsertRelease(client, release, audio.objectPath, cover.objectPath);
    }

    await upsertSimpleRows(client, db);
    await resetSequences(client);

    summary.startedAt = startedAt;
    summary.finishedAt = nowIso();
    summary.sourceFingerprint = fingerprint;
    summary.sourceName = config.sourceName;

    if (!config.dryRun) {
      await client.query(
        `insert into public.migration_runs
          (source_name, source_fingerprint, summary, started_at, finished_at)
         values ($1,$2,$3,$4,$5)`,
        [config.sourceName, fingerprint, summary, startedAt, summary.finishedAt],
      );
      await client.query("commit");
    }
  } catch (error) {
    if (!config.dryRun) await client.query("rollback");
    throw error;
  } finally {
    if (!config.dryRun) await client.end();
  }

  console.log(JSON.stringify(summary, null, 2));

  if (summary.failedMedia.length > 0) {
    console.error(`${summary.failedMedia.length} media item(s) failed. Review before cutover.`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
