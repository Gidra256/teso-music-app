import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import pg from "pg";

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

function toNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter(Number.isFinite))];
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
      const poolConfig = {
        connectionString: databaseUrl,
        max: Number(process.env.SUPABASE_POOL_SIZE || 1),
      };
      if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false") {
        poolConfig.ssl = { rejectUnauthorized: false };
      }
      pool = new Pool(poolConfig);
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
           and (release_date is null or release_date <= current_date)
       ) as has_due_release`,
    );
    if (!dueResult.rows[0]?.has_due_release) return;

    await pool.query(
      `with due as (
         select *
         from tesohub_music.releases
         where status = 'scheduled'
           and (release_date is null or release_date <= current_date)
           and public_song_id is null
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
       )
       update tesohub_music.releases release
       set public_song_id = inserted.id,
           status = 'published',
           published_at = coalesce(release.published_at, now()),
           updated_at = now()
       from inserted
       where release.id = inserted.source_release_id`,
    );
    await pool.query(
      `update tesohub_music.releases
       set status = 'published',
           published_at = coalesce(published_at, now()),
           updated_at = now()
       where status = 'scheduled'
         and (release_date is null or release_date <= current_date)
         and public_song_id is not null`,
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
      song_count: Number(row.song_count || songs.length || 0),
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

  async function listPublicArtists({ category = "", search = "" } = {}) {
    await publishDueReleases();
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
       order by lower(artist.name), artist.name`,
      params,
    );
    return result.rows.map(publicArtistFromRow);
  }

  async function getPublicArtist(artistId, { includeSongs = false } = {}) {
    await publishDueReleases();
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

  async function listPublicSongs({ artistId = null, category = "", search = "" } = {}) {
    await publishDueReleases();
    const params = [];
    const filters = [
      "song.status not in ('hidden', 'removed')",
      "artist.status <> 'removed'",
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
       order by song.is_featured desc, song.play_count desc, lower(song.title), song.title`,
      params,
    );
    return result.rows.map(publicSongFromRow);
  }

  async function getPublicSong(songId) {
    await publishDueReleases();
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
         and song.status not in ('hidden', 'removed')
         and artist.status <> 'removed'`,
      [songId],
    );
    return result.rows[0] ? publicSongFromRow(result.rows[0]) : null;
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
         and song.status not in ('hidden', 'removed')
         and artist.status <> 'removed'
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
      return getSupportTicketForListener(listenerId, ticket.id);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function addSupportTicketReply({
    attachment = null,
    listenerId,
    message = "",
    ticketIdentifier,
  }) {
    const client = await getPool().connect();
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
      return { ticket: await getSupportTicketForListener(listenerId, ticket.id) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
      return { ticket: await getSupportTicketForAdmin(ticket.id) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
      return getSupportTicketForAdmin(result.rows[0].id);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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

    const response = await recordStorageOperation(() =>
      fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`, {
        method: "POST",
        headers: {
          apikey: secretKey,
          authorization: `Bearer ${secretKey}`,
          "content-type": file.mimetype || "application/octet-stream",
          "x-upsert": "true",
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

  async function streamStorageObject({ bucket, objectPath, req, res }) {
    const headers = {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
    };
    const range = req.get("range");
    if (range) headers.range = range;

    const response = await recordStorageOperation(() =>
      fetch(
        `${supabaseUrl}/storage/v1/object/${bucket}/${encodeObjectPath(objectPath)}`,
        { headers },
      ),
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

  async function streamObject(req, res) {
    assertConfigured();
    const bucket = cleanText(req.params.bucket);
    const objectPath = req.params[0] || "";
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
    listPublicSongs,
    listSupportTicketsForAdmin,
    listSupportTicketsForListener,
    loadDb,
    loginExists,
    platformSettings,
    recordAdminAuditLog,
    removeSongFromPlaylist,
    saveDb,
    streamObject,
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
