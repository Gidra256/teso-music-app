import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import pg from "pg";

const { Pool } = pg;

function cleanText(value) {
  return String(value || "").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function encodeObjectPath(objectPath) {
  return cleanText(objectPath)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function safeUploadName(file) {
  const extension = path.extname(file?.originalname || "").toLowerCase();
  const base = path
    .basename(file?.originalname || "upload", extension)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${Date.now()}-${crypto.randomUUID()}-${base || "upload"}${extension}`;
}

function bucketForField(fieldname, buckets) {
  if (fieldname === "audio_upload") return buckets.audio;
  if (fieldname === "cover_upload") return buckets.artwork;
  if (fieldname === "photo_file") return buckets.avatars;
  throw new Error("Unsupported upload field.");
}

function folderForField(fieldname) {
  if (fieldname === "audio_upload") return "songs/audio";
  if (fieldname === "cover_upload") return "songs/covers";
  if (fieldname === "photo_file") return "artists/photos";
  return "misc";
}

function storagePathFromValue(value, bucket) {
  const clean = cleanText(value);
  if (!clean) return null;
  const prefix = `/api/storage/${bucket}/`;

  try {
    const url = new URL(clean);
    if (url.pathname.startsWith(prefix)) {
      return decodeURIComponent(url.pathname.slice(prefix.length));
    }
  } catch {}

  if (clean.startsWith(prefix)) {
    return decodeURIComponent(clean.slice(prefix.length));
  }

  if (
    !clean.startsWith("/") &&
    !/^https?:\/\//i.test(clean) &&
    !clean.startsWith("data:")
  ) {
    return clean;
  }

  return null;
}

function mediaColumns(value, bucket) {
  const objectPath = storagePathFromValue(value, bucket);
  return {
    objectPath,
    legacyValue: objectPath ? "" : cleanText(value),
  };
}

function idList(items) {
  return items
    .map((item) => Number(item?.id || 0))
    .filter((id) => Number.isFinite(id) && id > 0);
}

async function deleteMissing(client, table, ids, columnType = "bigint") {
  if (ids.length === 0) {
    await client.query(`delete from tesohub_music.${table}`);
    return;
  }
  await client.query(
    `delete from tesohub_music.${table} where not (id = any($1::${columnType}[]))`,
    [ids],
  );
}

export function createSupabasePersistence({
  databaseUrl,
  supabaseUrl,
  secretKey,
  buckets,
  storageUrlFor,
}) {
  let pool = null;

  function assertConfigured() {
    const missing = [];
    if (!databaseUrl) missing.push("DATABASE_URL");
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!secretKey) missing.push("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length) {
      throw new Error(`Supabase persistence is enabled but missing ${missing.join(", ")}.`);
    }
  }

  function getPool() {
    assertConfigured();
    if (!pool) {
      pool = new Pool({
        connectionString: databaseUrl,
        max: Number(process.env.SUPABASE_POOL_SIZE || 1),
      });
    }
    return pool;
  }

  async function queryRows(client, table, orderBy = "id") {
    const result = await client.query(
      `select * from tesohub_music.${table} order by ${orderBy}`,
    );
    return result.rows;
  }

  function artistFromRow(row) {
    return {
      id: Number(row.id),
      name: row.name || "",
      category: row.category || "",
      bio: row.bio || "",
      photo: row.photo_path ? storageUrlFor(buckets.avatars, row.photo_path) : row.legacy_photo || "",
      location: row.location || "",
      is_featured: Boolean(row.is_featured),
      status: row.status || "active",
      owner_listener: row.owner_listener_id ? Number(row.owner_listener_id) : null,
      source_application_id: row.source_application_id ? Number(row.source_application_id) : null,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  function songFromRow(row) {
    return {
      id: Number(row.id),
      artist: Number(row.artist_id),
      title: row.title || "",
      audio_file: row.audio_path ? storageUrlFor(buckets.audio, row.audio_path) : row.legacy_audio_file || "",
      cover_image: row.cover_path ? storageUrlFor(buckets.artwork, row.cover_path) : row.legacy_cover_image || "",
      genre: row.genre || "",
      genre_note: row.genre_note || "",
      lyrics: row.lyrics || "",
      play_count: Number(row.play_count || 0),
      release_date: toDateOnly(row.release_date),
      is_featured: Boolean(row.is_featured),
      status: row.status || "published",
      source_release_id: row.source_release_id ? Number(row.source_release_id) : null,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  function listenerFromRow(row) {
    return {
      id: Number(row.id),
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      password_hash: row.password_hash || "",
      role: row.role || "listener",
      plan: row.plan || "free",
      status: row.status || "active",
      artist_id: row.artist_id ? Number(row.artist_id) : null,
      artist_application_id: row.artist_application_id ? Number(row.artist_application_id) : null,
      suspension_reason: row.suspension_reason || "",
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  function applicationFromRow(row) {
    return {
      id: Number(row.id),
      listener: row.listener_id ? Number(row.listener_id) : null,
      artist: row.artist_id ? Number(row.artist_id) : null,
      artist_name: row.artist_name || "",
      contact_name: row.contact_name || "",
      bio: row.bio || "",
      country: row.country || "",
      region: row.region || "",
      genre: row.genre || "",
      genre_note: row.genre_note || "",
      phone: row.phone || "",
      email: row.email || "",
      photo: row.photo_path ? storageUrlFor(buckets.avatars, row.photo_path) : row.legacy_photo || "",
      social_link: row.social_link || "",
      genuine_confirmed: Boolean(row.genuine_confirmed),
      status: row.status || "pending",
      review_reason: row.review_reason || "",
      rejection_reason: row.rejection_reason || "",
      reviewed_by: row.reviewed_by || "",
      reviewed_at: toIso(row.reviewed_at),
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  function releaseFromRow(row) {
    return {
      id: Number(row.id),
      artist: row.artist_id ? Number(row.artist_id) : null,
      listener: row.listener_id ? Number(row.listener_id) : null,
      title: row.title || "",
      release_type: row.release_type || "Single",
      featured_artist: row.featured_artist || "",
      genre: row.genre || "",
      genre_note: row.genre_note || "",
      language: row.language || "",
      release_date: toDateOnly(row.release_date),
      explicit: Boolean(row.explicit),
      producer: row.producer || "",
      songwriter: row.songwriter || "",
      description: row.description || "",
      rights_confirmed: Boolean(row.rights_confirmed),
      audio_file: row.audio_path ? storageUrlFor(buckets.audio, row.audio_path) : row.legacy_audio_file || "",
      cover_image: row.cover_path ? storageUrlFor(buckets.artwork, row.cover_path) : row.legacy_cover_image || "",
      status: row.status || "draft",
      rejection_reason: row.rejection_reason || "",
      review_reason: row.review_reason || "",
      public_song: row.public_song_id ? Number(row.public_song_id) : null,
      submitted_at: toIso(row.submitted_at),
      approved_at: toIso(row.approved_at),
      published_at: toIso(row.published_at),
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  async function loadDb() {
    const pool = getPool();
    const [
      listeners,
      artists,
      genres,
      artistApplications,
      songs,
      releases,
      authTokens,
      songLikes,
      artistFollows,
      playlists,
      playlistSongs,
      reports,
      platformSettings,
      featureFlags,
      adminAuditLogs,
    ] = await Promise.all([
      queryRows(pool, "listeners"),
      queryRows(pool, "artists"),
      queryRows(pool, "genres", "position, name"),
      queryRows(pool, "artist_applications"),
      queryRows(pool, "songs"),
      queryRows(pool, "releases"),
      queryRows(pool, "auth_tokens", "created_at"),
      queryRows(pool, "song_likes"),
      queryRows(pool, "artist_follows"),
      queryRows(pool, "playlists"),
      queryRows(pool, "playlist_songs", "playlist_id, position, id"),
      queryRows(pool, "reports"),
      queryRows(pool, "platform_settings"),
      queryRows(pool, "feature_flags", "key"),
      queryRows(pool, "admin_audit_logs", "id"),
    ]);

    const settingsRow = platformSettings[0] || {};
    const featureFlagMap = Object.fromEntries(
      featureFlags.map((flag) => [flag.key, Boolean(flag.enabled)]),
    );

    return {
      listeners: listeners.map(listenerFromRow),
      artists: artists.map(artistFromRow),
      genres: genres.map((genre) => ({
          id: Number(genre.id),
          name: genre.name || "",
          active: Boolean(genre.active),
          position: Number(genre.position || 0),
          created_at: toIso(genre.created_at),
          updated_at: toIso(genre.updated_at),
        })),
        artistApplications: artistApplications.map(applicationFromRow),
        songs: songs.map(songFromRow),
        releases: releases.map(releaseFromRow),
        authTokens: authTokens.map((session) => ({
          id: session.id,
          listener: Number(session.listener_id),
          token_hash: session.token_hash || "",
          device_id: session.device_id || "",
          device_name: session.device_name || "",
          created_at: toIso(session.created_at),
          last_active_at: toIso(session.last_active_at),
        })),
        songLikes: songLikes.map((like) => ({
          id: Number(like.id),
          song: Number(like.song_id),
          listener: like.listener_id ? Number(like.listener_id) : null,
          device_id: like.device_id || "",
          created_at: toIso(like.created_at),
        })),
        artistFollows: artistFollows.map((follow) => ({
          id: Number(follow.id),
          artist: Number(follow.artist_id),
          listener: follow.listener_id ? Number(follow.listener_id) : null,
          device_id: follow.device_id || "",
          created_at: toIso(follow.created_at),
        })),
        playlists: playlists.map((playlist) => ({
          id: Number(playlist.id),
          owner: Number(playlist.owner_id),
          name: playlist.name || "",
          description: playlist.description || "",
          artwork: playlist.artwork_path
            ? storageUrlFor(buckets.artwork, playlist.artwork_path)
            : playlist.legacy_artwork || "",
          created_at: toIso(playlist.created_at),
          updated_at: toIso(playlist.updated_at),
        })),
        playlistSongs: playlistSongs.map((entry) => ({
          id: Number(entry.id),
          playlist: Number(entry.playlist_id),
          song: Number(entry.song_id),
          position: Number(entry.position || 0),
          added_at: toIso(entry.added_at),
        })),
        reports: reports.map((report) => ({
          id: Number(report.id),
          reporter: report.reporter_id ? Number(report.reporter_id) : null,
          target_type: report.target_type || "content",
          target_id: report.target_id ? Number(report.target_id) : null,
          reason: report.reason || "",
          status: report.status || "open",
          notes: report.notes || "",
          created_at: toIso(report.created_at),
          updated_at: toIso(report.updated_at),
        })),
        platformSettings: {
          registration_enabled: settingsRow.registration_enabled,
          artist_applications_enabled: settingsRow.artist_applications_enabled,
          music_uploads_enabled: settingsRow.music_uploads_enabled,
          maintenance_mode: settingsRow.maintenance_mode,
          maintenance_message: settingsRow.maintenance_message,
          max_audio_upload_mb: settingsRow.max_audio_upload_mb,
          max_artwork_upload_mb: settingsRow.max_artwork_upload_mb,
          supported_audio_formats: settingsRow.supported_audio_formats,
          minimum_supported_app_version: settingsRow.minimum_supported_app_version,
          app_announcement: settingsRow.app_announcement,
          updated_by: settingsRow.updated_by,
          created_at: toIso(settingsRow.created_at),
          updated_at: toIso(settingsRow.updated_at),
          feature_flags: featureFlagMap,
        },
      adminAuditLogs: adminAuditLogs.map((entry) => ({
          id: Number(entry.id),
          admin_user: entry.admin_user || "",
          admin_role: entry.admin_role || "super_admin",
          action: entry.action || "",
          target_type: entry.target_type || "system",
          target_id: entry.target_id ? Number(entry.target_id) : null,
          details: entry.details || {},
          reason: entry.reason || "",
          created_at: toIso(entry.created_at),
      })),
    };
  }

  async function upsertListener(client, listener) {
    await client.query(
      `insert into tesohub_music.listeners
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
        listener.id,
        listener.name || "",
        listener.email || "",
        listener.phone || "",
        listener.password_hash || "",
        listener.role || "listener",
        listener.plan || "free",
        listener.status || "active",
        numberOrNull(listener.artist_id),
        numberOrNull(listener.artist_application_id),
        listener.suspension_reason || "",
        listener.created_at || new Date().toISOString(),
        listener.updated_at || null,
      ],
    );
  }

  async function upsertArtist(client, artist) {
    const photo = mediaColumns(artist.photo, buckets.avatars);
    await client.query(
      `insert into tesohub_music.artists
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
        artist.id,
        artist.name || "",
        artist.category || "",
        artist.bio || "",
        photo.objectPath,
        photo.legacyValue,
        artist.location || "",
        Boolean(artist.is_featured),
        artist.status || "active",
        numberOrNull(artist.owner_listener),
        numberOrNull(artist.source_application_id),
        artist.created_at || new Date().toISOString(),
        artist.updated_at || null,
      ],
    );
  }

  async function upsertGenre(client, genre) {
    await client.query(
      `insert into tesohub_music.genres (id, name, active, position, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set
        name = excluded.name,
        active = excluded.active,
        position = excluded.position,
        updated_at = excluded.updated_at`,
      [
        genre.id,
        genre.name || "",
        genre.active !== false,
        Number(genre.position || 0),
        genre.created_at || new Date().toISOString(),
        genre.updated_at || null,
      ],
    );
  }

  async function upsertApplication(client, application) {
    const photo = mediaColumns(application.photo, buckets.avatars);
    await client.query(
      `insert into tesohub_music.artist_applications
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
        application.id,
        numberOrNull(application.listener),
        numberOrNull(application.artist),
        application.artist_name || "",
        application.contact_name || "",
        application.bio || "",
        application.country || "",
        application.region || "",
        application.genre || "",
        application.genre_note || "",
        application.phone || "",
        application.email || "",
        photo.objectPath,
        photo.legacyValue,
        application.social_link || "",
        Boolean(application.genuine_confirmed),
        application.status || "pending",
        application.review_reason || "",
        application.rejection_reason || "",
        application.reviewed_by || "",
        application.reviewed_at || null,
        application.created_at || new Date().toISOString(),
        application.updated_at || null,
      ],
    );
  }

  async function upsertSong(client, song) {
    const audio = mediaColumns(song.audio_file, buckets.audio);
    const cover = mediaColumns(song.cover_image, buckets.artwork);
    await client.query(
      `insert into tesohub_music.songs
        (id, artist_id, title, audio_path, legacy_audio_file, cover_path,
         legacy_cover_image, genre, genre_note, lyrics, play_count, release_date,
         is_featured, status, source_release_id, created_at, updated_at)
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
        song.id,
        song.artist,
        song.title || "",
        audio.objectPath,
        audio.legacyValue,
        cover.objectPath,
        cover.legacyValue,
        song.genre || "",
        song.genre_note || "",
        song.lyrics || "",
        Number(song.play_count || 0),
        cleanText(song.release_date) || null,
        Boolean(song.is_featured),
        song.status || "published",
        numberOrNull(song.source_release_id),
        song.created_at || new Date().toISOString(),
        song.updated_at || null,
      ],
    );
  }

  async function upsertRelease(client, release) {
    const audio = mediaColumns(release.audio_file, buckets.audio);
    const cover = mediaColumns(release.cover_image, buckets.artwork);
    await client.query(
      `insert into tesohub_music.releases
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
        release.id,
        numberOrNull(release.artist),
        numberOrNull(release.listener),
        release.title || "",
        release.release_type || "Single",
        release.featured_artist || "",
        release.genre || "",
        release.genre_note || "",
        release.language || "",
        cleanText(release.release_date) || null,
        Boolean(release.explicit),
        release.producer || "",
        release.songwriter || "",
        release.description || "",
        Boolean(release.rights_confirmed),
        audio.objectPath,
        audio.legacyValue,
        cover.objectPath,
        cover.legacyValue,
        release.status || "draft",
        release.rejection_reason || "",
        release.review_reason || "",
        numberOrNull(release.public_song),
        release.submitted_at || null,
        release.approved_at || null,
        release.published_at || null,
        release.created_at || new Date().toISOString(),
        release.updated_at || null,
      ],
    );
  }

  async function saveDb(db) {
    const client = await getPool().connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");

      for (const listener of db.listeners || []) await upsertListener(client, listener);
      for (const artist of db.artists || []) await upsertArtist(client, artist);
      for (const genre of db.genres || []) await upsertGenre(client, genre);
      for (const application of db.artistApplications || []) await upsertApplication(client, application);
      for (const song of db.songs || []) await upsertSong(client, song);
      for (const release of db.releases || []) await upsertRelease(client, release);

      await client.query("delete from tesohub_music.song_likes");
      for (const like of db.songLikes || []) {
        await client.query(
          `insert into tesohub_music.song_likes (song_id, listener_id, device_id, created_at)
           values ($1,$2,$3,$4)
           on conflict do nothing`,
          [
            like.song,
            numberOrNull(like.listener),
            like.device_id || "",
            like.created_at || new Date().toISOString(),
          ],
        );
      }

      await client.query("delete from tesohub_music.artist_follows");
      for (const follow of db.artistFollows || []) {
        await client.query(
          `insert into tesohub_music.artist_follows (artist_id, listener_id, device_id, created_at)
           values ($1,$2,$3,$4)
           on conflict do nothing`,
          [
            follow.artist,
            numberOrNull(follow.listener),
            follow.device_id || "",
            follow.created_at || new Date().toISOString(),
          ],
        );
      }

      for (const session of db.authTokens || []) {
        await client.query(
          `insert into tesohub_music.auth_tokens
            (id, listener_id, token_hash, device_id, device_name, created_at, last_active_at)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (id) do update set
            listener_id = excluded.listener_id,
            token_hash = excluded.token_hash,
            device_id = excluded.device_id,
            device_name = excluded.device_name,
            last_active_at = excluded.last_active_at`,
          [
            session.id,
            session.listener,
            session.token_hash || "",
            session.device_id || "",
            session.device_name || "",
            session.created_at || new Date().toISOString(),
            session.last_active_at || null,
          ],
        );
      }

      for (const playlist of db.playlists || []) {
        const artwork = mediaColumns(playlist.artwork, buckets.artwork);
        await client.query(
          `insert into tesohub_music.playlists
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
            playlist.name || "",
            playlist.description || "",
            artwork.objectPath,
            artwork.legacyValue,
            playlist.created_at || new Date().toISOString(),
            playlist.updated_at || null,
          ],
        );
      }

      await client.query("delete from tesohub_music.playlist_songs");
      for (const entry of db.playlistSongs || []) {
        await client.query(
          `insert into tesohub_music.playlist_songs (playlist_id, song_id, position, added_at)
           values ($1,$2,$3,$4)
           on conflict (playlist_id, song_id) do update set
            position = excluded.position,
            added_at = excluded.added_at`,
          [
            entry.playlist,
            entry.song,
            Number(entry.position || 0),
            entry.added_at || new Date().toISOString(),
          ],
        );
      }

      for (const report of db.reports || []) {
        await client.query(
          `insert into tesohub_music.reports
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
            report.created_at || new Date().toISOString(),
            report.updated_at || null,
          ],
        );
      }

      const settings = db.platformSettings || {};
      await client.query(
        `insert into tesohub_music.platform_settings
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
          settings.updated_at || new Date().toISOString(),
        ],
      );

      await client.query("delete from tesohub_music.feature_flags");
      for (const [key, enabled] of Object.entries(settings.feature_flags || {})) {
        await client.query(
          `insert into tesohub_music.feature_flags (key, enabled, updated_at)
           values ($1,$2,now())
           on conflict (key) do update set enabled = excluded.enabled, updated_at = excluded.updated_at`,
          [key, Boolean(enabled)],
        );
      }

      for (const entry of db.adminAuditLogs || []) {
        await client.query(
          `insert into tesohub_music.admin_audit_logs
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
            entry.admin_user || "",
            entry.admin_role || "super_admin",
            entry.action || "admin_action",
            entry.target_type || "system",
            numberOrNull(entry.target_id),
            entry.details || {},
            entry.reason || "",
            entry.created_at || new Date().toISOString(),
          ],
        );
      }

      await deleteMissing(client, "auth_tokens", (db.authTokens || []).map((session) => session.id).filter(Boolean), "text");
      await deleteMissing(client, "reports", idList(db.reports || []));
      await deleteMissing(client, "releases", idList(db.releases || []));
      await deleteMissing(client, "songs", idList(db.songs || []));
      await deleteMissing(client, "artist_applications", idList(db.artistApplications || []));
      await deleteMissing(client, "playlists", idList(db.playlists || []));
      await deleteMissing(client, "genres", idList(db.genres || []));
      await deleteMissing(client, "admin_audit_logs", idList(db.adminAuditLogs || []));
      await deleteMissing(client, "listeners", idList(db.listeners || []));
      await deleteMissing(client, "artists", idList(db.artists || []));

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function uploadFile(file) {
    assertConfigured();
    if (!file) return "";
    const bucket = bucketForField(file.fieldname, buckets);
    const objectPath = `${folderForField(file.fieldname)}/${safeUploadName(file)}`;
    const encodedPath = encodeObjectPath(objectPath);
    const body = file.buffer || (file.path ? await fs.readFile(file.path) : null);
    if (!body) throw new Error("Upload file buffer is missing.");

    const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`, {
      method: "POST",
      headers: {
        apikey: secretKey,
        authorization: `Bearer ${secretKey}`,
        "content-type": file.mimetype || "application/octet-stream",
        "x-upsert": "true",
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase upload failed (${response.status}): ${text || response.statusText}`);
    }

    return storageUrlFor(bucket, objectPath);
  }

  async function streamObject(req, res) {
    assertConfigured();
    const bucket = cleanText(req.params.bucket);
    const objectPath = req.params[0] || "";
    if (!Object.values(buckets).includes(bucket) || !objectPath) {
      res.status(404).json({ detail: "Media not found." });
      return;
    }

    const headers = {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
    };
    const range = req.get("range");
    if (range) headers.range = range;

    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/${bucket}/${encodeObjectPath(objectPath)}`,
      { headers },
    );

    if (!response.ok) {
      res.status(response.status).json({ detail: "Media not found." });
      return;
    }

    res.status(response.status);
    for (const header of [
      "accept-ranges",
      "cache-control",
      "content-length",
      "content-range",
      "content-type",
      "etag",
      "last-modified",
    ]) {
      const value = response.headers.get(header);
      if (value) res.set(header, value);
    }
    if (!res.get("cache-control")) {
      res.set("cache-control", "private, max-age=3600");
    }

    if (!response.body) {
      res.end();
      return;
    }

    Readable.fromWeb(response.body).pipe(res);
  }

  return {
    assertConfigured,
    loadDb,
    saveDb,
    streamObject,
    uploadFile,
  };
}
