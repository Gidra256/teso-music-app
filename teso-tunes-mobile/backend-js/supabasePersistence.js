import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import pg from "pg";
import { discoverySql } from "./discovery.js";
import { applyScopedChanges, WriteConflict } from "./scopedChanges.js";
import { canReadAudio, publicExternalAudio, storageAudioPath, validAudioId, validObjectPath } from "./audioAccess.js";

import {
  recordDbAcquire,
  recordDbQuery,
  recordStorageOperation,
} from "./perfMetrics.js";

const { Pool } = pg;

function cleanText(value) {
  return String(value || "").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toDateOnly(value) {
  if (!value) return "";
  // pg represents a DATE at local midnight, not a UTC timestamp. Converting
  // through ISO shifts the calendar day on hosts east of UTC.
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
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

function toNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter(Number.isFinite))];
}

export function createSupabasePersistence({
  databaseUrl,
  supabaseUrl,
  secretKey,
  buckets,
  storageUrlFor,
  poolFactory = (config) => new Pool(config),
  storageFetch = fetch,
}) {
  let pool = null;

  function instrumentQueryTarget(target) {
    if (!target || target.__tesohubPerfInstrumented) return target;
    const originalQuery = target.query.bind(target);
    target.query = (...args) => recordDbQuery(() => originalQuery(...args));
    Object.defineProperty(target, "__tesohubPerfInstrumented", {
      value: true,
    });
    return target;
  }

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
      const usesSupabasePooler = /supabase\.com|supabase\.co/i.test(databaseUrl);
      const poolConfig = {
        connectionString: databaseUrl,
        connectionTimeoutMillis: Number(process.env.SUPABASE_POOL_CONNECT_TIMEOUT_MS || 10000),
        idleTimeoutMillis: Number(process.env.SUPABASE_POOL_IDLE_TIMEOUT_MS || 30000),
        max: Number(process.env.SUPABASE_POOL_SIZE || 1),
        query_timeout: Number(process.env.SUPABASE_QUERY_TIMEOUT_MS || 30000),
        statement_timeout: Number(process.env.SUPABASE_STATEMENT_TIMEOUT_MS || 30000),
      };
      if (usesSupabasePooler || process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false") {
        poolConfig.ssl = { rejectUnauthorized: false };
      }
      pool = poolFactory(poolConfig);
      instrumentQueryTarget(pool);
      const originalConnect = pool.connect.bind(pool);
      pool.connect = (...args) =>
        recordDbAcquire(async () => instrumentQueryTarget(await originalConnect(...args)));
    }
    return pool;
  }

  async function queryRows(client, table, orderBy = "id") {
    const result = await client.query(
      `select * from tesohub_music.${table} order by ${orderBy}`,
    );
    return result.rows;
  }

  async function publishDueReleases() {
    const pool = getPool();
    const dueResult = await pool.query(
      `select exists (
         select 1
         from tesohub_music.releases
         where status = 'scheduled'
           and release_date <= (now() at time zone 'UTC')::date
       ) as has_due_release`,
    );
    if (!dueResult.rows[0]?.has_due_release) return;

    await pool.query(
      `with due as (
         select r.*
         from tesohub_music.releases r
         join tesohub_music.artists a on a.id = r.artist_id
         join tesohub_music.listeners l on l.id = r.listener_id
         where r.status = 'scheduled'
           and r.release_date <= (now() at time zone 'UTC')::date
           and r.public_song_id is null and r.approved_at is not null
           and r.rights_confirmed and btrim(r.title) <> ''
           and btrim(r.genre) <> '' and btrim(r.language) <> ''
           and coalesce(nullif(r.audio_path, ''), nullif(r.legacy_audio_file, '')) is not null
           and coalesce(nullif(r.cover_path, ''), nullif(r.legacy_cover_image, '')) is not null
           and a.owner_listener_id = l.id and l.artist_id = a.id
           and a.status = 'active' and l.status = 'active' and l.role = 'artist'
           and not exists (select 1 from tesohub_music.songs s where s.source_release_id = r.id)
         for update of r skip locked
         for share of a, l skip locked
       ),
       inserted as (
         insert into tesohub_music.songs
          (artist_id, title, audio_path, legacy_audio_file, cover_path,
           legacy_cover_image, genre, genre_note, lyrics, play_count, release_date,
           is_featured, status, source_release_id, created_at, updated_at)
         select
           artist_id,
           coalesce(nullif(title, ''), 'Untitled Song'),
           audio_path,
           legacy_audio_file,
           cover_path,
           legacy_cover_image,
           genre,
           genre_note,
           '',
           0,
           release_date,
           false,
           'published',
           id,
           now(),
           now()
         from due
         returning id, source_release_id
       ),
       published as (update tesohub_music.releases release
       set public_song_id = inserted.id,
           status = 'published',
           published_at = coalesce(release.published_at, now()),
           updated_at = now()
       from inserted
       where release.id = inserted.source_release_id
       returning release.id, release.public_song_id)
       insert into tesohub_music.admin_audit_logs
         (admin_user, admin_role, action, target_type, target_id, details, created_at)
       select 'publication-worker', 'system', 'publish_release', 'release', id,
         jsonb_build_object('public_song', public_song_id), now() from published`,
    );
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

  function publicArtistFromRow(row) {
    const artist = artistFromRow(row);
    return {
      ...artist,
      follower_count: Number(row.follower_count || 0),
      published_song_count: Number(row.published_song_count || 0),
      song_count: Number(row.song_count || 0),
      stream_count: Number(row.stream_count || 0),
    };
  }

  function publicSongFromRow(row) {
    const song = songFromRow(row);
    return {
      id: song.id,
      artist: song.artist,
      artist_name: row.artist_name || "",
      artist_category: row.artist_category || "",
      title: song.title,
      audio_file: song.audio_file,
      cover_image: song.cover_image,
      genre: song.genre || "",
      genre_note: song.genre_note || "",
      lyrics: song.lyrics || "",
      like_count: Number(row.like_count || 0),
      play_count: Number(song.play_count || 0),
      release_date: song.release_date || null,
      is_featured: Boolean(song.is_featured),
      status: song.status || "published",
      created_at: song.created_at,
      updated_at: song.updated_at || null,
    };
  }

  function compactApplicationFromRow(row) {
    if (!row?.application_id) return null;
    return {
      id: Number(row.application_id),
      artist_name: row.application_artist_name || "",
      status: row.application_status || "pending",
      review_reason: row.application_review_reason || "",
      rejection_reason: row.application_rejection_reason || "",
      created_at: toIso(row.application_created_at),
      updated_at: toIso(row.application_updated_at),
      reviewed_at: toIso(row.application_reviewed_at),
    };
  }

  function listenerProfileFromRow(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      role: row.role || "listener",
      artist_id: row.artist_id ? Number(row.artist_id) : null,
      artist_application: compactApplicationFromRow(row),
      liked_song_ids: toNumberArray(row.liked_song_ids),
      followed_artist_ids: toNumberArray(row.followed_artist_ids),
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  function playlistFromRow(row, songs = []) {
    return {
      id: Number(row.id),
      owner: Number(row.owner_id),
      owner_name: row.owner_name || "TesoHub listener",
      name: row.name || "Untitled Playlist",
      description: row.description || "",
      artwork: row.artwork_path
        ? storageUrlFor(buckets.artwork, row.artwork_path)
        : row.legacy_artwork || "",
      song_count: Number(row.song_count ?? songs?.length ?? 0),
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      ...(songs ? { songs } : {}),
    };
  }

  function supportAttachmentFromRow(row) {
    const path = row?.attachment_path || "";
    if (!path) return null;
    return {
      bucket: row.attachment_bucket || buckets.supportAttachments || "support-attachments",
      path,
      name: row.attachment_name || "attachment",
      type: row.attachment_type || "application/octet-stream",
      size: Number(row.attachment_size || 0),
    };
  }

  function supportMessageFromRow(row) {
    return {
      id: Number(row.id),
      ticket_id: Number(row.ticket_id),
      author_type: row.author_type || "user",
      listener_id: row.listener_id ? Number(row.listener_id) : null,
      admin_username: row.admin_username || "",
      message: row.message || "",
      attachment: supportAttachmentFromRow(row),
      created_at: toIso(row.created_at),
    };
  }

  function supportInternalNoteFromRow(row) {
    return {
      id: Number(row.id),
      ticket_id: Number(row.ticket_id),
      admin_username: row.admin_username || "",
      note: row.note || "",
      created_at: toIso(row.created_at),
    };
  }

  function supportAssignmentFromRow(row) {
    return {
      id: Number(row.id),
      ticket_id: Number(row.ticket_id),
      assigned_to: row.assigned_to || "",
      assigned_by: row.assigned_by || "",
      created_at: toIso(row.created_at),
    };
  }

  function supportTicketFromRow(
    row,
    { assignments = [], includeInternal = false, internalNotes = [], messages = [] } = {},
  ) {
    return {
      id: Number(row.id),
      reference: row.reference || "",
      user_id: Number(row.listener_id),
      listener_id: Number(row.listener_id),
      account_email: row.account_email || "",
      account_username: row.account_username || "",
      requester_role: row.requester_role || "listener",
      category: row.category || "",
      subject: row.subject || "",
      message: row.message || "",
      status: row.status || "open",
      priority: row.priority || "normal",
      assigned_to: row.assigned_to || "",
      attachment: supportAttachmentFromRow(row),
      message_count: Number(row.message_count || messages?.length || 0),
      last_user_reply_at: toIso(row.last_user_reply_at),
      last_admin_reply_at: toIso(row.last_admin_reply_at),
      resolved_at: toIso(row.resolved_at),
      closed_at: toIso(row.closed_at),
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      ...(messages ? { messages } : {}),
      ...(includeInternal ? { internal_notes: internalNotes, assignments } : {}),
    };
  }

  function supportTicketLookupClause(identifier, paramIndex, alias = "ticket") {
    const numericId = Number(identifier);
    if (Number.isInteger(numericId) && numericId > 0) {
      return { clause: `${alias}.id = $${paramIndex}`, value: numericId };
    }
    return { clause: `lower(${alias}.reference) = lower($${paramIndex})`, value: cleanText(identifier) };
  }

  async function loadDb() {
    const pool = getPool();
    // Keep one outstanding read per snapshot. Concurrent requests otherwise
    // enqueue fifteen reads each and can exceed the acquisition timeout.
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
    ] = [
      await queryRows(pool, "listeners"),
      await queryRows(pool, "artists"),
      await queryRows(pool, "genres", "position, name"),
      await queryRows(pool, "artist_applications"),
      await queryRows(pool, "songs"),
      await queryRows(pool, "releases"),
      await queryRows(pool, "auth_tokens", "created_at"),
      await queryRows(pool, "song_likes"),
      await queryRows(pool, "artist_follows"),
      await queryRows(pool, "playlists"),
      await queryRows(pool, "playlist_songs", "playlist_id, position, id"),
      await queryRows(pool, "reports"),
      await queryRows(pool, "platform_settings"),
      await queryRows(pool, "feature_flags", "key"),
      await queryRows(pool, "admin_audit_logs", "id"),
    ];

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

  async function listPublicArtists({ category = "", search = "", ...options } = {}) {
    const params = [];
    const filters = ["artist.status <> 'removed'"];
    if (category) {
      params.push(String(category).toLowerCase());
      filters.push(`lower(artist.category) = $${params.length}`);
    }
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      filters.push(`lower(artist.name) like $${params.length}`);
    }

    const discovery = discoverySql(options, params, "artist");
    filters.push(...discovery.filters);
    const result = await getPool().query(
      `select
         artist.*,
         coalesce(follows.follower_count, 0)::int as follower_count,
         coalesce(songs.song_count, 0)::int as song_count,
         coalesce(songs.published_song_count, 0)::int as published_song_count,
         coalesce(songs.stream_count, 0)::bigint as stream_count
       from tesohub_music.artists artist
       left join (
         select artist_id, count(*) as follower_count
         from tesohub_music.artist_follows
         group by artist_id
       ) follows on follows.artist_id = artist.id
       left join (
         select
           artist_id,
           count(*) as song_count,
           count(*) filter (where status not in ('hidden', 'removed')) as published_song_count,
           coalesce(sum(play_count), 0) as stream_count
         from tesohub_music.songs
         group by artist_id
       ) songs on songs.artist_id = artist.id
       where ${filters.join(" and ")}
       order by lower(artist.name), artist.name ${discovery.limit}`,
      params,
    );
    return result.rows.map(publicArtistFromRow);
  }

  async function getPublicArtist(artistId, { includeSongs = false } = {}) {
    const result = await getPool().query(
      `select
         artist.*,
         coalesce(follows.follower_count, 0)::int as follower_count,
         coalesce(songs.song_count, 0)::int as song_count,
         coalesce(songs.published_song_count, 0)::int as published_song_count,
         coalesce(songs.stream_count, 0)::bigint as stream_count
       from tesohub_music.artists artist
       left join (
         select artist_id, count(*) as follower_count
         from tesohub_music.artist_follows
         group by artist_id
       ) follows on follows.artist_id = artist.id
       left join (
         select
           artist_id,
           count(*) as song_count,
           count(*) filter (where status not in ('hidden', 'removed')) as published_song_count,
           coalesce(sum(play_count), 0) as stream_count
         from tesohub_music.songs
         group by artist_id
       ) songs on songs.artist_id = artist.id
       where artist.id = $1 and artist.status <> 'removed'`,
      [artistId],
    );
    const artist = result.rows[0] ? publicArtistFromRow(result.rows[0]) : null;
    if (!artist || !includeSongs) return artist;
    artist.songs = await listPublicSongs({ artistId: artist.id });
    return artist;
  }

  async function listPublicSongs({ artistId = null, category = "", search = "", ...options } = {}) {
    const params = [];
    const filters = [
      "song.status = 'published'",
      "artist.status = 'active'",
      "(song.source_release_id is null or exists (select 1 from tesohub_music.releases source where source.id = song.source_release_id and source.status = 'published' and source.public_song_id = song.id))",
    ];
    if (artistId) {
      params.push(Number(artistId));
      filters.push(`song.artist_id = $${params.length}`);
    }
    if (category) {
      params.push(String(category).toLowerCase());
      filters.push(`lower(artist.category) = $${params.length}`);
    }
    if (search) {
      params.push(`%${String(search).toLowerCase()}%`);
      filters.push(
        `(lower(song.title) like $${params.length} or lower(artist.name) like $${params.length})`,
      );
    }

    const discovery = discoverySql(options, params);
    filters.push(...discovery.filters);
    const result = await getPool().query(
      `select
         song.*,
         artist.name as artist_name,
         artist.category as artist_category,
         coalesce(likes.like_count, 0)::int as like_count
       from tesohub_music.songs song
       join tesohub_music.artists artist on artist.id = song.artist_id
       left join (
         select song_id, count(*) as like_count
         from tesohub_music.song_likes
         group by song_id
       ) likes on likes.song_id = song.id
       where ${filters.join(" and ")}
       order by ${discovery.order || "song.is_featured desc, song.play_count desc, lower(song.title), song.title"}
       ${discovery.limit}`,
      params,
    );
    return result.rows.map(publicSongFromRow);
  }

  async function getPublicSong(songId) {
    const result = await getPool().query(
      `select
         song.*,
         artist.name as artist_name,
         artist.category as artist_category,
         coalesce(likes.like_count, 0)::int as like_count
       from tesohub_music.songs song
       join tesohub_music.artists artist on artist.id = song.artist_id
       left join (
         select song_id, count(*) as like_count
         from tesohub_music.song_likes
         group by song_id
       ) likes on likes.song_id = song.id
       where song.id = $1
         and song.status = 'published'
         and artist.status = 'active'
         and (song.source_release_id is null or exists (
           select 1 from tesohub_music.releases source where source.id = song.source_release_id
             and source.status = 'published' and source.public_song_id = song.id))`,
      [songId],
    );
    return result.rows[0] ? publicSongFromRow(result.rows[0]) : null;
  }

  async function listPublicGenres() {
    const result = await getPool().query(
      `select name from tesohub_music.genres where active = true order by position, name`,
    );
    return result.rows.map(row => row.name);
  }

  async function platformSettings() {
    const result = await getPool().query(
      `select
         settings.*,
         coalesce(
           jsonb_object_agg(flags.key, flags.enabled)
             filter (where flags.key is not null),
           '{}'::jsonb
         ) as feature_flags
       from tesohub_music.platform_settings settings
       left join tesohub_music.feature_flags flags on true
       where settings.id = 1
       group by settings.id`,
    );
    const row = result.rows[0] || {};
    return {
      registration_enabled: row.registration_enabled !== false,
      artist_applications_enabled: row.artist_applications_enabled !== false,
      music_uploads_enabled: row.music_uploads_enabled !== false,
      maintenance_mode: Boolean(row.maintenance_mode),
      maintenance_message: row.maintenance_message || "",
      max_audio_upload_mb: Number(row.max_audio_upload_mb || 80),
      max_artwork_upload_mb: Number(row.max_artwork_upload_mb || 10),
      supported_audio_formats: row.supported_audio_formats || [],
      minimum_supported_app_version: row.minimum_supported_app_version || "",
      app_announcement: row.app_announcement || "",
      feature_flags: row.feature_flags || {},
      updated_by: row.updated_by || "",
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  async function listenerProfile(listenerId, client = getPool()) {
    const result = await client.query(
      `select
         listener.*,
         coalesce(likes.ids, '{}'::bigint[]) as liked_song_ids,
         coalesce(follows.ids, '{}'::bigint[]) as followed_artist_ids,
         application.id as application_id,
         application.artist_name as application_artist_name,
         application.status as application_status,
         application.review_reason as application_review_reason,
         application.rejection_reason as application_rejection_reason,
         application.created_at as application_created_at,
         application.updated_at as application_updated_at,
         application.reviewed_at as application_reviewed_at
       from tesohub_music.listeners listener
       left join lateral (
         select array_agg(distinct song_id) as ids
         from tesohub_music.song_likes
         where listener_id = listener.id
       ) likes on true
       left join lateral (
         select array_agg(distinct artist_id) as ids
         from tesohub_music.artist_follows
         where listener_id = listener.id
       ) follows on true
       left join lateral (
         select *
         from tesohub_music.artist_applications
         where listener_id = listener.id
         order by id desc
         limit 1
       ) application on true
       where listener.id = $1`,
      [listenerId],
    );
    return listenerProfileFromRow(result.rows[0]);
  }

  async function listenerByTokenHash(tokenHash) {
    if (!tokenHash) return null;
    const result = await getPool().query(
      `with session as (
         update tesohub_music.auth_tokens
         set last_active_at = now()
         where token_hash = $1
         returning listener_id
       )
       select listener.*
       from tesohub_music.listeners listener
       join session on session.listener_id = listener.id`,
      [tokenHash],
    );
    return result.rows[0] ? listenerFromRow(result.rows[0]) : null;
  }

  async function listenerByIdentifier({ email = "", phone = "" } = {}) {
    const filters = [];
    const params = [];
    if (email) {
      params.push(String(email).toLowerCase());
      filters.push(`lower(email) = $${params.length}`);
    }
    if (phone) {
      params.push(String(phone));
      filters.push(`phone = $${params.length}`);
    }
    if (filters.length === 0) return null;
    const result = await getPool().query(
      `select *
       from tesohub_music.listeners
       where ${filters.join(" or ")}
       order by id
       limit 1`,
      params,
    );
    return result.rows[0] ? listenerFromRow(result.rows[0]) : null;
  }

  async function loginExists({ email = "", phone = "" } = {}) {
    return Boolean(await listenerByIdentifier({ email, phone }));
  }

  async function attachDeviceEngagement(client, listenerId, deviceId) {
    if (!listenerId || !deviceId) return;
    await client.query(
      `update tesohub_music.song_likes like_row
       set listener_id = $1
       where like_row.device_id = $2
         and not exists (
           select 1
           from tesohub_music.song_likes duplicate
           where duplicate.song_id = like_row.song_id
             and duplicate.listener_id = $1
         )`,
      [listenerId, deviceId],
    );
    await client.query(
      `update tesohub_music.artist_follows follow_row
       set listener_id = $1
       where follow_row.device_id = $2
         and not exists (
           select 1
           from tesohub_music.artist_follows duplicate
           where duplicate.artist_id = follow_row.artist_id
             and duplicate.listener_id = $1
         )`,
      [listenerId, deviceId],
    );
  }

  async function createListenerAccount({
    deviceId = "",
    deviceName = "",
    email = "",
    name = "",
    passwordHash = "",
    phone = "",
    sessionId,
    tokenHash,
  }) {
    const client = await getPool().connect();
    try {
      await client.query("begin");
      const listenerResult = await client.query(
        `insert into tesohub_music.listeners
          (name, email, phone, password_hash, role, plan, status, created_at, updated_at)
         values ($1,$2,$3,$4,'listener','free','active',now(),now())
         returning *`,
        [name, email, phone, passwordHash],
      );
      const listener = listenerFromRow(listenerResult.rows[0]);
      await attachDeviceEngagement(client, listener.id, deviceId);
      await client.query(
        `insert into tesohub_music.auth_tokens
          (id, listener_id, token_hash, device_id, device_name, created_at, last_active_at)
         values ($1,$2,$3,$4,$5,now(),now())`,
        [sessionId, listener.id, tokenHash, deviceId, deviceName],
      );
      const profile = await listenerProfile(listener.id, client);
      await client.query("commit");
      return profile;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function createAuthSession({
    deviceId = "",
    deviceName = "",
    listenerId,
    sessionId,
    tokenHash,
  }) {
    const client = await getPool().connect();
    try {
      await client.query("begin");
      await attachDeviceEngagement(client, listenerId, deviceId);
      await client.query(
        `insert into tesohub_music.auth_tokens
          (id, listener_id, token_hash, device_id, device_name, created_at, last_active_at)
         values ($1,$2,$3,$4,$5,now(),now())`,
        [sessionId, listenerId, tokenHash, deviceId, deviceName],
      );
      const profile = await listenerProfile(listenerId, client);
      await client.query("commit");
      return profile;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function followArtist({ artistId, deviceId = "", listenerId = null }) {
    const result = await getPool().query(
      `with target as (
         select id
         from tesohub_music.artists
         where id = $1 and status <> 'removed'
       ),
       inserted as (
         insert into tesohub_music.artist_follows
          (artist_id, listener_id, device_id, created_at)
         select id, $2::bigint, $3::text, now()
         from target
         on conflict do nothing
       ),
       updated as (
         update tesohub_music.artist_follows follow_row
         set listener_id = $2::bigint
         where $2::bigint is not null
           and $3::text <> ''
           and follow_row.artist_id = $1
           and follow_row.device_id = $3::text
           and follow_row.listener_id is null
           and exists (select 1 from target)
           and not exists (
             select 1
             from tesohub_music.artist_follows duplicate
             where duplicate.artist_id = follow_row.artist_id
               and duplicate.listener_id = $2::bigint
           )
       )
       select
         exists(select 1 from target) as found,
         (
           select count(*)::int
           from tesohub_music.artist_follows
           where artist_id = $1
         ) as follower_count`,
      [artistId, numberOrNull(listenerId), deviceId || ""],
    );
    if (!result.rows[0]?.found) return { notFound: true };
    return {
      followed: true,
      follower_count: Math.max(0, Number(result.rows[0]?.follower_count || 0)),
    };
  }

  async function unfollowArtist({ artistId, deviceId = "", listenerId = null }) {
    const result = await getPool().query(
      `with target as (
         select id
         from tesohub_music.artists
         where id = $1 and status <> 'removed'
       ),
       deleted as (
         delete from tesohub_music.artist_follows
         where artist_id = $1
           and exists (select 1 from target)
           and (
             ($2::bigint is not null and listener_id = $2::bigint)
             or ($3::text <> '' and device_id = $3::text)
           )
       )
       select
         exists(select 1 from target) as found,
         (
           select count(*)::int
           from tesohub_music.artist_follows
           where artist_id = $1
         ) as follower_count`,
      [artistId, numberOrNull(listenerId), deviceId || ""],
    );
    if (!result.rows[0]?.found) return { notFound: true };
    return {
      followed: false,
      follower_count: Math.max(0, Number(result.rows[0]?.follower_count || 0)),
    };
  }

  async function likeSong({ songId, deviceId = "", listenerId = null }) {
    const result = await getPool().query(
      `with target as (
         select song.id
         from tesohub_music.songs song
         join tesohub_music.artists artist on artist.id = song.artist_id
         where song.id = $1
           and song.status not in ('hidden', 'removed')
           and artist.status <> 'removed'
       ),
       inserted as (
         insert into tesohub_music.song_likes
          (song_id, listener_id, device_id, created_at)
         select id, $2::bigint, $3::text, now()
         from target
         on conflict do nothing
       ),
       updated as (
         update tesohub_music.song_likes like_row
         set listener_id = $2::bigint
         where $2::bigint is not null
           and $3::text <> ''
           and like_row.song_id = $1
           and like_row.device_id = $3::text
           and like_row.listener_id is null
           and exists (select 1 from target)
           and not exists (
             select 1
             from tesohub_music.song_likes duplicate
             where duplicate.song_id = like_row.song_id
               and duplicate.listener_id = $2::bigint
           )
       )
       select
         exists(select 1 from target) as found,
         (
           select count(*)::int
           from tesohub_music.song_likes
           where song_id = $1
         ) as like_count`,
      [songId, numberOrNull(listenerId), deviceId || ""],
    );
    if (!result.rows[0]?.found) return { notFound: true };
    return {
      liked: true,
      like_count: Math.max(0, Number(result.rows[0]?.like_count || 0)),
    };
  }

  async function unlikeSong({ songId, deviceId = "", listenerId = null }) {
    const result = await getPool().query(
      `with target as (
         select song.id
         from tesohub_music.songs song
         join tesohub_music.artists artist on artist.id = song.artist_id
         where song.id = $1
           and song.status not in ('hidden', 'removed')
           and artist.status <> 'removed'
       ),
       deleted as (
         delete from tesohub_music.song_likes
         where song_id = $1
           and exists (select 1 from target)
           and (
             ($2::bigint is not null and listener_id = $2::bigint)
             or ($3::text <> '' and device_id = $3::text)
           )
       )
       select
         exists(select 1 from target) as found,
         (
           select count(*)::int
           from tesohub_music.song_likes
           where song_id = $1
         ) as like_count`,
      [songId, numberOrNull(listenerId), deviceId || ""],
    );
    if (!result.rows[0]?.found) return { notFound: true };
    return {
      liked: false,
      like_count: Math.max(0, Number(result.rows[0]?.like_count || 0)),
    };
  }

  async function playlistSongsFor(playlistId, client = getPool()) {
    const result = await client.query(
      `select
         song.*,
         artist.name as artist_name,
         artist.category as artist_category,
         coalesce(likes.like_count, 0)::int as like_count,
         entry.position as playlist_position,
         entry.added_at as playlist_added_at
       from tesohub_music.playlist_songs entry
       join tesohub_music.songs song on song.id = entry.song_id
       join tesohub_music.artists artist on artist.id = song.artist_id
       left join (
         select song_id, count(*) as like_count
         from tesohub_music.song_likes
         group by song_id
       ) likes on likes.song_id = song.id
       where entry.playlist_id = $1
         and song.status = 'published'
         and artist.status = 'active'
         and (song.source_release_id is null or exists (
           select 1 from tesohub_music.releases source where source.id = song.source_release_id
             and source.status = 'published' and source.public_song_id = song.id))
       order by entry.position, entry.added_at, entry.id`,
      [playlistId],
    );
    return result.rows.map((row) => ({
      ...publicSongFromRow(row),
      playlist_position: Number(row.playlist_position || 0),
      playlist_added_at: toIso(row.playlist_added_at),
    }));
  }

  async function playlistRowForOwner(listenerId, playlistId, client = getPool()) {
    const result = await client.query(
      `select
         playlist.*,
         listener.name as owner_name,
         coalesce(song_counts.song_count, 0)::int as song_count
       from tesohub_music.playlists playlist
       join tesohub_music.listeners listener on listener.id = playlist.owner_id
       left join (
         select playlist_id, count(*) as song_count
         from tesohub_music.playlist_songs
         group by playlist_id
       ) song_counts on song_counts.playlist_id = playlist.id
       where playlist.id = $1 and playlist.owner_id = $2`,
      [playlistId, listenerId],
    );
    return result.rows[0] || null;
  }

  async function listPlaylists(listenerId) {
    const result = await getPool().query(
      `select
         playlist.*,
         listener.name as owner_name,
         coalesce(song_counts.song_count, 0)::int as song_count
       from tesohub_music.playlists playlist
       join tesohub_music.listeners listener on listener.id = playlist.owner_id
       left join (
         select playlist_id, count(*) as song_count
         from tesohub_music.playlist_songs
         group by playlist_id
       ) song_counts on song_counts.playlist_id = playlist.id
       where playlist.owner_id = $1
       order by coalesce(playlist.updated_at, playlist.created_at) desc`,
      [listenerId],
    );
    return result.rows.map((row) => playlistFromRow(row, null));
  }

  async function getPlaylist(listenerId, playlistId) {
    const row = await playlistRowForOwner(listenerId, playlistId);
    if (!row) return null;
    return playlistFromRow(row, await playlistSongsFor(playlistId));
  }

  async function createPlaylist({ artwork = "", description = "", listenerId, name }) {
    const result = await getPool().query(
      `insert into tesohub_music.playlists
        (owner_id, name, description, legacy_artwork, created_at, updated_at)
       values ($1,$2,$3,$4,now(),now())
       returning *,
         (select name from tesohub_music.listeners where id = $1) as owner_name,
         0::int as song_count`,
      [listenerId, name, description, artwork],
    );
    return playlistFromRow(result.rows[0], []);
  }

  async function updatePlaylist({ artwork, description, listenerId, name, playlistId }) {
    const existing = await playlistRowForOwner(listenerId, playlistId);
    if (!existing) return null;
    const result = await getPool().query(
      `update tesohub_music.playlists
       set name = coalesce($3, name),
           description = coalesce($4, description),
           legacy_artwork = coalesce($5, legacy_artwork),
           updated_at = now()
       where id = $1 and owner_id = $2
       returning *,
         (select name from tesohub_music.listeners where id = $2) as owner_name,
         (select count(*)::int from tesohub_music.playlist_songs where playlist_id = $1) as song_count`,
      [
        playlistId,
        listenerId,
        name ?? null,
        description ?? null,
        artwork ?? null,
      ],
    );
    return playlistFromRow(result.rows[0], await playlistSongsFor(playlistId));
  }

  async function deletePlaylist(listenerId, playlistId) {
    const result = await getPool().query(
      `delete from tesohub_music.playlists
       where id = $1 and owner_id = $2`,
      [playlistId, listenerId],
    );
    return result.rowCount > 0;
  }

  async function addSongToPlaylist({ listenerId, playlistId, songId }) {
    const client = await getPool().connect();
    try {
      await client.query("begin");
      const playlist = await playlistRowForOwner(listenerId, playlistId, client);
      if (!playlist) {
        await client.query("rollback");
        return { notFound: "playlist" };
      }
      const songResult = await client.query(
        `select song.id
         from tesohub_music.songs song
         join tesohub_music.artists artist on artist.id = song.artist_id
         where song.id = $1
           and song.status not in ('hidden', 'removed')
           and artist.status <> 'removed'`,
        [songId],
      );
      if (songResult.rowCount === 0) {
        await client.query("rollback");
        return { notFound: "song" };
      }
      const existing = await client.query(
        `select id
         from tesohub_music.playlist_songs
         where playlist_id = $1 and song_id = $2`,
        [playlistId, songId],
      );
      if (existing.rowCount > 0) {
        await client.query("commit");
        return {
          added: false,
          duplicate: true,
          playlist: playlistFromRow(
            await playlistRowForOwner(listenerId, playlistId, client),
            await playlistSongsFor(playlistId, client),
          ),
        };
      }
      const positionResult = await client.query(
        `select coalesce(max(position), 0) + 1 as next_position
         from tesohub_music.playlist_songs
         where playlist_id = $1`,
        [playlistId],
      );
      await client.query(
        `insert into tesohub_music.playlist_songs
          (playlist_id, song_id, position, added_at)
         values ($1,$2,$3,now())`,
        [
          playlistId,
          songId,
          Number(positionResult.rows[0]?.next_position || 1),
        ],
      );
      await client.query(
        `update tesohub_music.playlists
         set updated_at = now()
         where id = $1`,
        [playlistId],
      );
      const nextPlaylist = playlistFromRow(
        await playlistRowForOwner(listenerId, playlistId, client),
        await playlistSongsFor(playlistId, client),
      );
      await client.query("commit");
      return { added: true, duplicate: false, playlist: nextPlaylist };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function removeSongFromPlaylist({ listenerId, playlistId, songId }) {
    const client = await getPool().connect();
    try {
      await client.query("begin");
      const playlist = await playlistRowForOwner(listenerId, playlistId, client);
      if (!playlist) {
        await client.query("rollback");
        return null;
      }
      const result = await client.query(
        `delete from tesohub_music.playlist_songs
         where playlist_id = $1 and song_id = $2`,
        [playlistId, songId],
      );
      await client.query(
        `update tesohub_music.playlists
         set updated_at = now()
         where id = $1`,
        [playlistId],
      );
      const nextPlaylist = playlistFromRow(
        await playlistRowForOwner(listenerId, playlistId, client),
        await playlistSongsFor(playlistId, client),
      );
      await client.query("commit");
      return { removed: result.rowCount > 0, playlist: nextPlaylist };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function listSupportTicketsForListener(listenerId) {
    const result = await getPool().query(
      `select
         ticket.*,
         (
           select count(*)::int
           from tesohub_music.support_messages message
           where message.ticket_id = ticket.id
         ) as message_count
       from tesohub_music.support_tickets ticket
       where ticket.listener_id = $1
       order by ticket.updated_at desc, ticket.id desc`,
      [listenerId],
    );
    return result.rows.map((row) => supportTicketFromRow(row, { messages: null }));
  }

  async function getSupportTicketForListener(listenerId, ticketIdentifier) {
    const lookup = supportTicketLookupClause(ticketIdentifier, 2);
    const ticketResult = await getPool().query(
      `select
         ticket.*,
         (
           select count(*)::int
           from tesohub_music.support_messages message
           where message.ticket_id = ticket.id
         ) as message_count
       from tesohub_music.support_tickets ticket
       where ticket.listener_id = $1 and ${lookup.clause}
       limit 1`,
      [listenerId, lookup.value],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) return null;

    const messagesResult = await getPool().query(
      `select *
       from tesohub_music.support_messages
       where ticket_id = $1
       order by created_at, id`,
      [ticket.id],
    );
    return supportTicketFromRow(ticket, {
      messages: messagesResult.rows.map(supportMessageFromRow),
    });
  }

  async function createSupportTicket({
    accountEmail = "",
    accountUsername = "",
    attachment = null,
    category = "",
    listenerId,
    message = "",
    priority = "normal",
    reference,
    requesterRole = "listener",
    subject = "",
  }) {
    const client = await getPool().connect();
    let createdTicketId = null;
    try {
      await client.query("begin");
      const ticketResult = await client.query(
        `insert into tesohub_music.support_tickets
          (reference, listener_id, account_email, account_username, requester_role,
           category, subject, message, status, priority, attachment_bucket,
           attachment_path, attachment_name, attachment_type, attachment_size,
           last_user_reply_at, created_at, updated_at)
         values
          ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,$12,$13,$14,now(),now(),now())
         returning *`,
        [
          reference,
          listenerId,
          accountEmail,
          accountUsername,
          requesterRole,
          category,
          subject,
          message,
          priority,
          attachment?.bucket || "",
          attachment?.path || "",
          attachment?.name || "",
          attachment?.type || "",
          Number(attachment?.size || 0),
        ],
      );
      const ticket = ticketResult.rows[0];
      await client.query(
        `insert into tesohub_music.support_messages
          (ticket_id, author_type, listener_id, admin_username, message,
           attachment_bucket, attachment_path, attachment_name, attachment_type,
           attachment_size, created_at)
         values ($1,'user',$2,'',$3,$4,$5,$6,$7,$8,now())`,
        [
          ticket.id,
          listenerId,
          message,
          attachment?.bucket || "",
          attachment?.path || "",
          attachment?.name || "",
          attachment?.type || "",
          Number(attachment?.size || 0),
        ],
      );
      await client.query("commit");
      createdTicketId = ticket.id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return getSupportTicketForListener(listenerId, createdTicketId);
  }

  async function addSupportTicketReply({
    attachment = null,
    listenerId,
    message = "",
    ticketIdentifier,
  }) {
    const client = await getPool().connect();
    let updatedTicketId = null;
    try {
      await client.query("begin");
      const lookup = supportTicketLookupClause(ticketIdentifier, 2);
      const ticketResult = await client.query(
        `select *
         from tesohub_music.support_tickets ticket
         where ticket.listener_id = $1 and ${lookup.clause}
         for update`,
        [listenerId, lookup.value],
      );
      const ticket = ticketResult.rows[0];
      if (!ticket) {
        await client.query("rollback");
        return { notFound: true };
      }
      if (["resolved", "closed"].includes(ticket.status)) {
        await client.query("rollback");
        return { notOpen: true, ticket: supportTicketFromRow(ticket, { messages: [] }) };
      }

      await client.query(
        `insert into tesohub_music.support_messages
          (ticket_id, author_type, listener_id, admin_username, message,
           attachment_bucket, attachment_path, attachment_name, attachment_type,
           attachment_size, created_at)
         values ($1,'user',$2,'',$3,$4,$5,$6,$7,$8,now())`,
        [
          ticket.id,
          listenerId,
          message,
          attachment?.bucket || "",
          attachment?.path || "",
          attachment?.name || "",
          attachment?.type || "",
          Number(attachment?.size || 0),
        ],
      );
      await client.query(
        `update tesohub_music.support_tickets
         set status = case when status = 'waiting_on_user' then 'open' else status end,
             last_user_reply_at = now(),
             updated_at = now()
         where id = $1`,
        [ticket.id],
      );
      await client.query("commit");
      updatedTicketId = ticket.id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return { ticket: await getSupportTicketForListener(listenerId, updatedTicketId) };
  }

  async function listSupportTicketsForAdmin({
    category = "",
    search = "",
    status = "",
  } = {}) {
    const params = [];
    const filters = [];
    if (status) {
      params.push(status);
      filters.push(`ticket.status = $${params.length}`);
    }
    if (category) {
      params.push(category);
      filters.push(`ticket.category = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      filters.push(`(
        lower(ticket.reference) like $${params.length}
        or lower(ticket.account_email) like $${params.length}
        or lower(ticket.account_username) like $${params.length}
        or lower(ticket.subject) like $${params.length}
        or lower(ticket.message) like $${params.length}
      )`);
    }

    const where = filters.length ? `where ${filters.join(" and ")}` : "";
    const result = await getPool().query(
      `select
         ticket.*,
         listener.name as listener_name,
         listener.email as listener_email,
         listener.phone as listener_phone,
         listener.role as listener_role,
         listener.status as listener_status,
         listener.artist_id as listener_artist_id,
         artist.name as artist_name,
         (
           select count(*)::int
           from tesohub_music.support_messages message
           where message.ticket_id = ticket.id
         ) as message_count
       from tesohub_music.support_tickets ticket
       join tesohub_music.listeners listener on listener.id = ticket.listener_id
       left join tesohub_music.artists artist on artist.id = listener.artist_id
       ${where}
       order by ticket.updated_at desc, ticket.id desc
       limit 250`,
      params,
    );
    return result.rows.map((row) => ({
      ...supportTicketFromRow(row, { messages: null }),
      user: {
        id: Number(row.listener_id),
        name: row.listener_name || "",
        email: row.listener_email || "",
        phone: row.listener_phone || "",
        role: row.listener_role || "listener",
        status: row.listener_status || "active",
        artist_id: row.listener_artist_id ? Number(row.listener_artist_id) : null,
        artist_name: row.artist_name || "",
      },
    }));
  }

  async function getSupportTicketForAdmin(ticketIdentifier) {
    const lookup = supportTicketLookupClause(ticketIdentifier, 1);
    const ticketResult = await getPool().query(
      `select
         ticket.*,
         listener.name as listener_name,
         listener.email as listener_email,
         listener.phone as listener_phone,
         listener.role as listener_role,
         listener.status as listener_status,
         listener.artist_id as listener_artist_id,
         artist.name as artist_name,
         (
           select count(*)::int
           from tesohub_music.support_messages message
           where message.ticket_id = ticket.id
         ) as message_count
       from tesohub_music.support_tickets ticket
       join tesohub_music.listeners listener on listener.id = ticket.listener_id
       left join tesohub_music.artists artist on artist.id = listener.artist_id
       where ${lookup.clause}
       limit 1`,
      [lookup.value],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) return null;

    const [messagesResult, notesResult, assignmentsResult] = await Promise.all([
      getPool().query(
        `select *
         from tesohub_music.support_messages
         where ticket_id = $1
         order by created_at, id`,
        [ticket.id],
      ),
      getPool().query(
        `select *
         from tesohub_music.support_internal_notes
         where ticket_id = $1
         order by created_at, id`,
        [ticket.id],
      ),
      getPool().query(
        `select *
         from tesohub_music.support_assignments
         where ticket_id = $1
         order by created_at desc, id desc`,
        [ticket.id],
      ),
    ]);

    return {
      ...supportTicketFromRow(ticket, {
        assignments: assignmentsResult.rows.map(supportAssignmentFromRow),
        includeInternal: true,
        internalNotes: notesResult.rows.map(supportInternalNoteFromRow),
        messages: messagesResult.rows.map(supportMessageFromRow),
      }),
      user: {
        id: Number(ticket.listener_id),
        name: ticket.listener_name || "",
        email: ticket.listener_email || "",
        phone: ticket.listener_phone || "",
        role: ticket.listener_role || "listener",
        status: ticket.listener_status || "active",
        artist_id: ticket.listener_artist_id ? Number(ticket.listener_artist_id) : null,
        artist_name: ticket.artist_name || "",
      },
    };
  }

  async function addSupportAdminReply({
    adminUsername = "",
    message = "",
    ticketIdentifier,
  }) {
    const client = await getPool().connect();
    let updatedTicketId = null;
    try {
      await client.query("begin");
      const lookup = supportTicketLookupClause(ticketIdentifier, 1);
      const ticketResult = await client.query(
        `select *
         from tesohub_music.support_tickets ticket
         where ${lookup.clause}
         for update`,
        [lookup.value],
      );
      const ticket = ticketResult.rows[0];
      if (!ticket) {
        await client.query("rollback");
        return { notFound: true };
      }
      if (ticket.status === "closed") {
        await client.query("rollback");
        return { closed: true };
      }

      await client.query(
        `insert into tesohub_music.support_messages
          (ticket_id, author_type, listener_id, admin_username, message, created_at)
         values ($1,'admin',null,$2,$3,now())`,
        [ticket.id, adminUsername, message],
      );
      await client.query(
        `update tesohub_music.support_tickets
         set status = case when status in ('open', 'in_progress') then 'waiting_on_user' else status end,
             last_admin_reply_at = now(),
             updated_at = now()
         where id = $1`,
        [ticket.id],
      );
      await client.query("commit");
      updatedTicketId = ticket.id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return { ticket: await getSupportTicketForAdmin(updatedTicketId) };
  }

  async function addSupportInternalNote({
    adminUsername = "",
    note = "",
    ticketIdentifier,
  }) {
    const lookup = supportTicketLookupClause(ticketIdentifier, 1);
    const result = await getPool().query(
      `with target as (
         select id
         from tesohub_music.support_tickets ticket
         where ${lookup.clause}
       ),
       inserted as (
         insert into tesohub_music.support_internal_notes
          (ticket_id, admin_username, note, created_at)
         select id, $2, $3, now()
         from target
         returning *
       ),
       touched as (
         update tesohub_music.support_tickets
         set updated_at = now()
         where id in (select ticket_id from inserted)
       )
       select * from inserted`,
      [lookup.value, adminUsername, note],
    );
    return result.rows[0] ? supportInternalNoteFromRow(result.rows[0]) : null;
  }

  async function updateSupportTicketForAdmin({
    assignedTo,
    changedBy = "",
    priority,
    status,
    ticketIdentifier,
  }) {
    const client = await getPool().connect();
    let updatedTicketId = null;
    try {
      await client.query("begin");
      const lookup = supportTicketLookupClause(ticketIdentifier, 1);
      const existingResult = await client.query(
        `select *
         from tesohub_music.support_tickets ticket
         where ${lookup.clause}
         for update`,
        [lookup.value],
      );
      const existing = existingResult.rows[0];
      if (!existing) {
        await client.query("rollback");
        return null;
      }

      const nextStatus = status || existing.status;
      const nextPriority = priority || existing.priority;
      const nextAssignedTo =
        assignedTo === undefined ? existing.assigned_to || "" : assignedTo || "";

      const result = await client.query(
        `update tesohub_music.support_tickets
         set status = $2,
             priority = $3,
             assigned_to = $4,
             resolved_at = case when $2 = 'resolved' and resolved_at is null then now() when $2 <> 'resolved' then null else resolved_at end,
             closed_at = case when $2 = 'closed' and closed_at is null then now() when $2 <> 'closed' then null else closed_at end,
             updated_at = now()
         where id = $1
         returning *`,
        [existing.id, nextStatus, nextPriority, nextAssignedTo],
      );

      if (nextAssignedTo !== (existing.assigned_to || "")) {
        await client.query(
          `insert into tesohub_music.support_assignments
            (ticket_id, assigned_to, assigned_by, created_at)
           values ($1,$2,$3,now())`,
          [existing.id, nextAssignedTo, changedBy],
        );
      }

      await client.query("commit");
      updatedTicketId = result.rows[0].id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return getSupportTicketForAdmin(updatedTicketId);
  }

  async function supportAttachmentForListener({
    attachmentId,
    kind,
    listenerId,
    ticketIdentifier,
  }) {
    const lookup = supportTicketLookupClause(ticketIdentifier, 2);
    const params = [listenerId, lookup.value, Number(attachmentId)];
    const result = await getPool().query(
      kind === "message"
        ? `select
             message.attachment_bucket,
             message.attachment_path,
             message.attachment_name,
             message.attachment_type,
             message.attachment_size
           from tesohub_music.support_messages message
           join tesohub_music.support_tickets ticket on ticket.id = message.ticket_id
           where ticket.listener_id = $1
             and ${lookup.clause}
             and message.id = $3
             and nullif(message.attachment_path, '') is not null
           limit 1`
        : `select
             ticket.attachment_bucket,
             ticket.attachment_path,
             ticket.attachment_name,
             ticket.attachment_type,
             ticket.attachment_size
           from tesohub_music.support_tickets ticket
           where ticket.listener_id = $1
             and ${lookup.clause}
             and ticket.id = $3
             and nullif(ticket.attachment_path, '') is not null
           limit 1`,
      params,
    );
    return supportAttachmentFromRow(result.rows[0]);
  }

  async function supportAttachmentForAdmin({ attachmentId, kind, ticketIdentifier }) {
    const lookup = supportTicketLookupClause(ticketIdentifier, 1);
    const params = [lookup.value, Number(attachmentId)];
    const result = await getPool().query(
      kind === "message"
        ? `select
             message.attachment_bucket,
             message.attachment_path,
             message.attachment_name,
             message.attachment_type,
             message.attachment_size
           from tesohub_music.support_messages message
           join tesohub_music.support_tickets ticket on ticket.id = message.ticket_id
           where ${lookup.clause}
             and message.id = $2
             and nullif(message.attachment_path, '') is not null
           limit 1`
        : `select
             ticket.attachment_bucket,
             ticket.attachment_path,
             ticket.attachment_name,
             ticket.attachment_type,
             ticket.attachment_size
           from tesohub_music.support_tickets ticket
           where ${lookup.clause}
             and ticket.id = $2
             and nullif(ticket.attachment_path, '') is not null
           limit 1`,
      params,
    );
    return supportAttachmentFromRow(result.rows[0]);
  }

  async function recordAdminAuditLog({
    action = "admin_action",
    adminRole = "super_admin",
    adminUser = "",
    details = {},
    reason = "",
    targetId = null,
    targetType = "system",
  } = {}) {
    await getPool().query(
      `insert into tesohub_music.admin_audit_logs
        (admin_user, admin_role, action, target_type, target_id, details, reason, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,now())`,
      [
        adminUser,
        adminRole,
        action,
        targetType,
        numberOrNull(targetId),
        details && typeof details === "object" ? details : {},
        reason,
      ],
    );
  }

  async function saveChanges(before, after, stored = before) {
    const client = await getPool().connect();
    try {
      await client.query("begin");
      const reflect = await applyScopedChanges(client, before, after, {mediaColumns, buckets, stored});
      await client.query("commit");
      reflect();
    } catch (error) {
      await client.query("rollback");
      if (["23505", "23503", "40001", "40P01"].includes(error.code)) throw new WriteConflict();
      throw error;
    } finally {
      client.release();
    }
  }

  async function recordSongPlay(songId) {
    const result = await getPool().query(
      `update tesohub_music.songs song set play_count = song.play_count + 1
       from tesohub_music.artists artist
       where song.id = $1 and song.artist_id = artist.id
         and song.status = 'published' and artist.status = 'active'
         and (song.source_release_id is null or exists (
           select 1 from tesohub_music.releases source where source.id = song.source_release_id
             and source.status = 'published' and source.public_song_id = song.id))
       returning song.*, artist.name as artist_name, artist.category as artist_category,
         (select count(*)::int from tesohub_music.song_likes likes where likes.song_id = song.id) as like_count`,
      [songId],
    );
    return result.rows[0] ? publicSongFromRow(result.rows[0]) : null;
  }

  async function uploadFile(file) {
    assertConfigured();
    if (!file) return "";
    const bucket = bucketForField(file.fieldname, buckets);
    const objectPath = `${folderForField(file.fieldname)}/${safeUploadName(file)}`;
    const encodedPath = encodeObjectPath(objectPath);
    const body = file.buffer || (file.path ? await fs.readFile(file.path) : null);
    if (!body) throw new Error("Upload file buffer is missing.");

    const response = await recordStorageOperation(() =>
      fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`, {
        method: "POST",
        headers: {
          apikey: secretKey,
          authorization: `Bearer ${secretKey}`,
          "content-type": file.mimetype || "application/octet-stream",
          "x-upsert": "false",
        },
        body,
      }),
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase upload failed (${response.status}): ${text || response.statusText}`);
    }

    return storageUrlFor(bucket, objectPath);
  }

  async function uploadSupportAttachment(file, reference = "support") {
    assertConfigured();
    if (!file) return null;
    const bucket = buckets.supportAttachments || "support-attachments";
    const safeReference =
      cleanText(reference)
        .replace(/[^a-z0-9-]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "support";
    const objectPath = `support/${safeReference}/${safeUploadName(file)}`;
    const encodedPath = encodeObjectPath(objectPath);
    const body = file.buffer || (file.path ? await fs.readFile(file.path) : null);
    if (!body) throw new Error("Upload file buffer is missing.");

    const response = await recordStorageOperation(() =>
      fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`, {
        method: "POST",
        headers: {
          apikey: secretKey,
          authorization: `Bearer ${secretKey}`,
          "content-type": file.mimetype || "application/octet-stream",
          "x-upsert": "false",
        },
        body,
      }),
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase support upload failed (${response.status}): ${text || response.statusText}`);
    }

    return {
      bucket,
      path: objectPath,
      name: file.originalname || "attachment",
      type: file.mimetype || "application/octet-stream",
      size: Number(file.size || body.length || 0),
    };
  }

  async function audioCandidates(target, tokenHash = "") {
    const isObject = target.kind === "object";
    if (isObject ? !validObjectPath(target.value) :
      !["song", "release"].includes(target.kind) || !validAudioId(target.value)) return [];
    const viewer = `left join tesohub_music.listeners viewer on viewer.id = (
      select listener_id from tesohub_music.auth_tokens where token_hash = $2 limit 1
    )`;
    const columns = `artist.status as artist_status, viewer.role as viewer_role,
      viewer.status as viewer_status, viewer.artist_id as viewer_artist_id`;
    const songQuery = `select 'song' as kind, song.id, song.status, song.artist_id,
      song.audio_path, song.legacy_audio_file, ${columns},
      (song.status = 'published' and artist.status = 'active' and
        (song.source_release_id is null or (source.status = 'published' and source.public_song_id = song.id))) as is_public
      from tesohub_music.songs song
      join tesohub_music.artists artist on artist.id = song.artist_id
      left join tesohub_music.releases source on source.id = song.source_release_id
      ${viewer}
      where ${isObject ? "song.audio_path = $1" : "song.id = $1::bigint"}`;
    const releaseQuery = `select 'release' as kind, release.id, release.status, release.artist_id,
      release.audio_path, release.legacy_audio_file, ${columns},
      (release.status = 'published' and artist.status = 'active' and exists (
        select 1 from tesohub_music.songs published
        where published.id = release.public_song_id and published.artist_id = release.artist_id
          and published.status = 'published'
          and (published.audio_path = release.audio_path or
            (nullif(published.legacy_audio_file, '') is not null and published.legacy_audio_file = release.legacy_audio_file))
      )) as is_public
      from tesohub_music.releases release
      join tesohub_music.artists artist on artist.id = release.artist_id
      ${viewer}
      where ${isObject ? "release.audio_path = $1" : "release.id = $1::bigint"}`;
    const query = isObject ? `${songQuery} union all ${releaseQuery}` :
      target.kind === "song" ? songQuery : releaseQuery;
    // Deliberately read-only: never call public catalog readers, which publish
    // scheduled releases as a side effect. Fail closed if bucket privacy changes.
    const result = await getPool().query(
      `select candidates.* from (${query}) candidates
       where exists (select 1 from storage.buckets where id = $3 and public = false)`,
      [String(target.value), tokenHash, buckets.audio],
    );
    return result.rows;
  }

  async function streamAudio(target, req, res, { tokenHash = "", reviewer = {} } = {}) {
    res.set("cache-control", "private, no-store");
    res.set("vary", "Authorization, Cookie");
    res.set("x-content-type-options", "nosniff");
    const candidates = await audioCandidates(target, tokenHash);
    const row = candidates.find((candidate) => canReadAudio(candidate, reviewer));
    if (!row) return res.status(404).json({ detail: "Media not found." });
    const objectPath = row.audio_path || storageAudioPath(row.legacy_audio_file, buckets.audio, supabaseUrl);
    if (objectPath && validObjectPath(objectPath)) {
      return streamStorageObject({ bucket: buckets.audio, objectPath, req, res });
    }
    // Previously public third-party recordings can still play. Never redirect a
    // private preview, a signed URL, or a Supabase URL outside the guarded proxy.
    const external = row.is_public && publicExternalAudio(row.legacy_audio_file, supabaseUrl);
    if (external) return res.redirect(302, external);
    return res.status(404).json({ detail: "Media not found." });
  }

  async function streamStorageObject({ bucket, objectPath, req, res }) {
    const headers = {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
    };
    const range = req.get("range");
    if (range) headers.range = range;

    const response = await recordStorageOperation(() =>
      storageFetch(
        `${supabaseUrl}/storage/v1/object/${bucket}/${encodeObjectPath(objectPath)}`,
        { headers, redirect: "error" },
      ),
    );

    if (!response.ok) {
      if (response.status === 416) {
        const contentRange = response.headers.get("content-range");
        if (contentRange) res.set("content-range", contentRange);
        res.set("accept-ranges", "bytes");
        res.status(416).end();
        return;
      }
      res.status(response.status === 404 ? 404 : 502).json({ detail: "Media not found." });
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
      if (value && !(header === "cache-control" && res.get("cache-control"))) res.set(header, value);
    }
    if (!res.get("cache-control")) {
      res.set("cache-control", "private, max-age=3600");
    }

    if (!response.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(response.body);
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  }

  async function streamObject(req, res, access = {}) {
    assertConfigured();
    const bucket = cleanText(req.params.bucket);
    const objectPath = req.params[0] || "";
    if (bucket === buckets.audio) {
      return streamAudio({ kind: "object", value: objectPath }, req, res, access);
    }
    const publicMediaBuckets = [buckets.audio, buckets.artwork, buckets.avatars].filter(Boolean);
    if (!publicMediaBuckets.includes(bucket) || !objectPath) {
      res.status(404).json({ detail: "Media not found." });
      return;
    }

    await streamStorageObject({ bucket, objectPath, req, res });
  }

  async function streamSupportAttachment(attachment, req, res) {
    assertConfigured();
    const bucket = attachment?.bucket || "";
    const objectPath = attachment?.path || "";
    if (bucket !== (buckets.supportAttachments || "support-attachments") || !objectPath) {
      res.status(404).json({ detail: "Attachment not found." });
      return;
    }
    res.set("content-disposition", `inline; filename="${String(attachment.name || "attachment").replace(/"/g, "")}"`);
    await streamStorageObject({ bucket, objectPath, req, res });
  }

  return {
    assertConfigured,
    addSongToPlaylist,
    addSupportAdminReply,
    addSupportInternalNote,
    addSupportTicketReply,
    createAuthSession,
    createListenerAccount,
    createPlaylist,
    createSupportTicket,
    deletePlaylist,
    followArtist,
    getPlaylist,
    getPublicArtist,
    getPublicSong,
    getSupportTicketForAdmin,
    getSupportTicketForListener,
    likeSong,
    listenerByIdentifier,
    listenerByTokenHash,
    listenerProfile,
    listPlaylists,
    listPublicArtists,
    listPublicGenres,
    listPublicSongs,
    listSupportTicketsForAdmin,
    listSupportTicketsForListener,
    loadDb,
    loginExists,
    platformSettings,
    publishDueReleases,
    recordAdminAuditLog,
    removeSongFromPlaylist,
    saveChanges,
    recordSongPlay,
    streamObject,
    streamAudio,
    streamSupportAttachment,
    supportAttachmentForAdmin,
    supportAttachmentForListener,
    unfollowArtist,
    unlikeSong,
    updatePlaylist,
    updateSupportTicketForAdmin,
    uploadFile,
    uploadSupportAttachment,
  };
}
