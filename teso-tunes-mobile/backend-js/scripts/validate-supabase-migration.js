import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const storageRoot = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : backendRoot;

const databaseUrl = process.env.DATABASE_URL || "";
const legacyDbPath = process.env.LEGACY_DB_PATH || path.join(storageRoot, "data", "db.json");
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || "";
const validateStorage = process.env.VALIDATE_STORAGE === "1";

if (!databaseUrl) {
  console.error("Set DATABASE_URL before validating migration.");
  process.exit(1);
}

const tableMap = {
  adminAuditLogs: "admin_audit_logs",
  artistApplications: "artist_applications",
  artistFollows: "artist_follows",
  artists: "artists",
  authTokens: "auth_tokens",
  genres: "genres",
  listeners: "listeners",
  playlistSongs: "playlist_songs",
  playlists: "playlists",
  releases: "releases",
  reports: "reports",
  songLikes: "song_likes",
  songs: "songs",
};

async function tableCount(client, table) {
  const result = await client.query(`select count(*)::int as count from public.${table}`);
  return result.rows[0].count;
}

async function objectExists(bucket, objectPath) {
  const encodedPath = objectPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`, {
    method: "HEAD",
    headers: {
      apikey: supabaseSecretKey,
      authorization: `Bearer ${supabaseSecretKey}`,
    },
  });
  return response.ok;
}

async function validateStorageObjects(client) {
  if (!validateStorage) {
    return { skipped: true, reason: "Set VALIDATE_STORAGE=1 to check object existence." };
  }
  if (!supabaseUrl || !supabaseSecretKey) {
    return { skipped: true, reason: "SUPABASE_URL and SUPABASE_SECRET_KEY are required." };
  }

  const audioBucket = process.env.SUPABASE_AUDIO_BUCKET || "music-audio";
  const artworkBucket = process.env.SUPABASE_ARTWORK_BUCKET || "artwork";
  const avatarBucket = process.env.SUPABASE_AVATAR_BUCKET || "avatars";
  const checks = [];

  const mediaResult = await client.query(`
    select 'audio' as kind, $1::text as bucket, audio_path as object_path
    from public.songs
    where audio_path is not null
    union all
    select 'song_cover' as kind, $2::text as bucket, cover_path as object_path
    from public.songs
    where cover_path is not null
    union all
    select 'artist_photo' as kind, $3::text as bucket, photo_path as object_path
    from public.artists
    where photo_path is not null
  `, [audioBucket, artworkBucket, avatarBucket]);

  for (const row of mediaResult.rows) {
    const exists = await objectExists(row.bucket, row.object_path);
    checks.push({ ...row, exists });
  }

  return {
    checked: checks.length,
    missing: checks.filter((item) => !item.exists),
  };
}

async function main() {
  const source = JSON.parse(await fs.readFile(legacyDbPath, "utf8"));
  const client = new Client({
    connectionString: databaseUrl,
    ssl: !/localhost|127\.0\.0\.1/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const counts = {};
    for (const [sourceKey, table] of Object.entries(tableMap)) {
      const sourceCount = Array.isArray(source[sourceKey]) ? source[sourceKey].length : 0;
      const destinationCount = await tableCount(client, table);
      counts[sourceKey] = {
        source: sourceCount,
        destination: destinationCount,
        matches: sourceCount === destinationCount,
      };
    }

    const brokenRefs = await client.query(`
      select 'songs.artist_id' as relationship, count(*)::int as broken
      from public.songs s left join public.artists a on a.id = s.artist_id
      where a.id is null
      union all
      select 'song_likes.song_id', count(*)::int
      from public.song_likes l left join public.songs s on s.id = l.song_id
      where s.id is null
      union all
      select 'artist_follows.artist_id', count(*)::int
      from public.artist_follows f left join public.artists a on a.id = f.artist_id
      where a.id is null
      union all
      select 'playlist_songs.playlist_id', count(*)::int
      from public.playlist_songs ps left join public.playlists p on p.id = ps.playlist_id
      where p.id is null
      union all
      select 'playlist_songs.song_id', count(*)::int
      from public.playlist_songs ps left join public.songs s on s.id = ps.song_id
      where s.id is null
    `);

    const songsMissingAudio = await client.query(`
      select id, title, legacy_audio_file
      from public.songs
      where nullif(legacy_audio_file, '') is not null
        and audio_path is null
      order by id
    `);

    const storage = await validateStorageObjects(client);
    const report = {
      counts,
      foreignKeyIntegrity: brokenRefs.rows,
      songsMissingMigratedAudio: songsMissingAudio.rows,
      storage,
    };

    console.log(JSON.stringify(report, null, 2));

    const mismatches = Object.values(counts).filter((item) => !item.matches).length;
    const broken = brokenRefs.rows.filter((item) => item.broken > 0).length;
    if (mismatches || broken || songsMissingAudio.rows.length || storage.missing?.length) {
      process.exitCode = 2;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
