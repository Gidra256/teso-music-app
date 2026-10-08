import { isDeepStrictEqual } from "node:util";

// Only these persisted columns may be written by the legacy DTO compatibility layer.
const definitions = [
  ["listeners", "listeners", "name email phone password_hash role plan status artist_id artist_application_id suspension_reason created_at updated_at"],
  ["artists", "artists", "name category bio location is_featured status owner_listener:owner_listener_id source_application_id created_at updated_at", {photo:["avatars", "photo_path", "legacy_photo"]}],
  ["genres", "genres", "name active position created_at updated_at"],
  ["artistApplications", "artist_applications", "listener:listener_id artist:artist_id artist_name contact_name bio country region genre genre_note phone email social_link genuine_confirmed status review_reason rejection_reason reviewed_by reviewed_at created_at updated_at", {photo:["avatars", "photo_path", "legacy_photo"]}],
  ["songs", "songs", "artist:artist_id title genre genre_note lyrics play_count release_date is_featured status source_release_id created_at updated_at", {audio_file:["audio", "audio_path", "legacy_audio_file"], cover_image:["artwork", "cover_path", "legacy_cover_image"]}],
  ["releases", "releases", "artist:artist_id listener:listener_id title release_type featured_artist genre genre_note language release_date explicit producer songwriter description rights_confirmed status rejection_reason review_reason public_song:public_song_id submitted_at approved_at published_at created_at updated_at", {audio_file:["audio", "audio_path", "legacy_audio_file"], cover_image:["artwork", "cover_path", "legacy_cover_image"]}],
  ["authTokens", "auth_tokens", "listener:listener_id token_hash device_id device_name created_at last_active_at"],
  ["songLikes", "song_likes", "song:song_id listener:listener_id device_id created_at"],
  ["artistFollows", "artist_follows", "artist:artist_id listener:listener_id device_id created_at"],
  ["playlists", "playlists", "owner:owner_id name description created_at updated_at", {artwork:["artwork", "artwork_path", "legacy_artwork"]}],
  ["playlistSongs", "playlist_songs", "playlist:playlist_id song:song_id position added_at"],
  ["reports", "reports", "reporter:reporter_id target_type target_id reason status notes created_at updated_at"],
  ["adminAuditLogs", "admin_audit_logs", "admin_user admin_role action target_type target_id details reason created_at"],
  ["platformSettings", "platform_settings", "registration_enabled artist_applications_enabled music_uploads_enabled maintenance_mode maintenance_message max_audio_upload_mb max_artwork_upload_mb supported_audio_formats minimum_supported_app_version app_announcement updated_by updated_at"],
  ["featureFlags", "feature_flags", "enabled", {}, "key"],
].map(([collection, table, fields, media = {}, key = "id"]) => ({
  collection, table, media, key, fields:fields.split(" ").map(field => field.split(":")),
}));

const references = {
  listeners:{artist_id:"artists", artist_application_id:"artistApplications"},
  artists:{owner_listener:"listeners", source_application_id:"artistApplications"},
  artistApplications:{listener:"listeners", artist:"artists"},
  songs:{artist:"artists", source_release_id:"releases"},
  releases:{artist:"artists", listener:"listeners", public_song:"songs"},
  authTokens:{listener:"listeners"}, songLikes:{listener:"listeners", song:"songs"},
  artistFollows:{listener:"listeners", artist:"artists"}, playlists:{owner:"listeners"},
  playlistSongs:{playlist:"playlists", song:"songs"}, reports:{reporter:"listeners"},
};
const targetCollections = {artist:"artists", song:"songs", release:"releases", artist_application:"artistApplications", user:"listeners", account:"listeners", playlist:"playlists", genre:"genres"};

export class WriteConflict extends Error {
  constructor() {
    super("This record changed while saving. Reload and try again.");
    this.code = "STALE_WRITE";
  }
}

function items(db, def) {
  if (def.collection === "platformSettings") return [{...db.platformSettings, id:1}];
  if (def.collection === "featureFlags") return Object.entries(db.platformSettings?.feature_flags || {}).map(([key, enabled]) => ({key, enabled:Boolean(enabled)}));
  if (!Array.isArray(db[def.collection])) throw new Error("Incomplete change-set snapshot.");
  return db[def.collection];
}

function index(rows, key) {
  const result = new Map();
  for (const row of rows) {
    if (row[key] == null || result.has(String(row[key]))) throw new Error("Invalid change-set identity.");
    result.set(String(row[key]), row);
  }
  return result;
}

function mapped(row, def, mediaColumns, buckets) {
  const result = {[def.key]:row[def.key]};
  for (const [field, column = field] of def.fields) {
    if (row[field] !== undefined) result[column] = field === "release_date" ? row[field] || null : row[field];
  }
  for (const [field, [bucket, column, legacy]] of Object.entries(def.media)) {
    if (row[field] === undefined) continue;
    const media = mediaColumns(row[field], buckets[bucket]);
    result[column] = media.objectPath;
    result[legacy] = media.legacyValue;
  }
  return result;
}

function comparisonColumn(column) {
  // pg/JS dates have millisecond precision; PostgreSQL timestamps may not.
  return column.endsWith("_at") ? `date_trunc('milliseconds', ${column})` : column;
}

// The baseline is owned by the server, never supplied by a request. No table is
// replaced: unchanged rows/columns never enter a SQL mutation or delete predicate.
export async function applyScopedChanges(client, before, after, {mediaColumns, buckets, stored = before}) {
  if (!before || !after) throw new Error("A tracked baseline is required for Supabase writes.");
  const plans = definitions.map(def => {
    const old = index(items(before, def), def.key);
    const persisted = index(items(stored, def), def.key);
    const next = index(items(after, def), def.key);
    const inserts = [], updates = [], deletes = [];
    for (const [id, original] of next) {
      const previous = old.get(id);
      const entry = {original, row:structuredClone(original), previous, stored:persisted.get(id)};
      if (!previous) inserts.push(entry);
      else if (!isDeepStrictEqual(mapped(previous, def, mediaColumns, buckets), mapped(original, def, mediaColumns, buckets))) {
        if (entry.stored) updates.push(entry);
        else inserts.push(entry);
      }
    }
    for (const [id] of old) if (!next.has(id) && persisted.has(id)) deletes.push(persisted.get(id));
    return {def, inserts, updates, deletes};
  });
  if (!plans.some(p => p.inserts.length || p.updates.length || p.deletes.length)) return () => {};

  // An approval depends on the current account/artist relationship as well as
  // the release. Hold those rows until the scoped transaction has committed.
  for (const {def, updates} of plans) if (def.collection === "releases") for (const {row, previous} of updates) {
    if (previous.status === "under_review" && ["scheduled", "published"].includes(row.status)) {
      const linked = await client.query(`select a.id from tesohub_music.artists a
        join tesohub_music.listeners l on l.id = a.owner_listener_id
        where a.id = $1 and l.id = $2 and l.artist_id = a.id
          and a.status = 'active' and l.status = 'active' and l.role = 'artist'
        for share of a, l`, [row.artist, row.listener]);
      if (linked.rowCount !== 1) throw new WriteConflict();
    }
  }

  // IDs allocated from PostgreSQL sequences cannot collide with concurrent
  // account/catalog/audit inserts. Remap workflow references before any insert.
  const remaps = {};
  for (const {def, inserts} of plans) {
    remaps[def.collection] = new Map();
    if (["authTokens", "platformSettings", "featureFlags"].includes(def.collection)) continue;
    for (const entry of inserts) {
      const {rows} = await client.query("select nextval(pg_get_serial_sequence($1, 'id')) as id", [`tesohub_music.${def.table}`]);
      const id = Number(rows[0].id);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid generated identity.");
      remaps[def.collection].set(String(entry.row.id), id);
      entry.row.id = id;
    }
  }
  const remap = (collection, value) => remaps[collection]?.get(String(value)) ?? value;
  for (const {def, inserts, updates} of plans) for (const entry of [...inserts, ...updates]) {
    for (const [field, collection] of Object.entries(references[def.collection] || {})) {
      entry.row[field] = remap(collection, entry.row[field]);
    }
    if (def.collection === "adminAuditLogs" || def.collection === "reports") {
      entry.row.target_id = remap(targetCollections[entry.row.target_type], entry.row.target_id);
    }
    if (def.collection === "adminAuditLogs" && entry.row.details) {
      for (const [field, collection] of Object.entries({artist_id:"artists", public_song:"songs"})) {
        if (field in entry.row.details) entry.row.details[field] = remap(collection, entry.row.details[field]);
      }
    }
  }

  for (const {def, deletes} of [...plans].reverse()) for (const previous of deletes) {
    const old = mapped(previous, def, mediaColumns, buckets);
    const keys = Object.keys(old).filter(k => !["updated_at", "last_active_at"].includes(k));
    const result = await client.query(`delete from tesohub_music.${def.table} where ${keys.map((key, i) => `${comparisonColumn(key)} is not distinct from $${i + 1}`).join(" and ")} returning ${def.key}`, keys.map(k => old[k]));
    if (result.rowCount !== 1) throw new WriteConflict();
  }
  for (const {def, inserts} of plans) for (const {row} of inserts) {
    const data = mapped(row, def, mediaColumns, buckets);
    const keys = Object.keys(data);
    await client.query(`insert into tesohub_music.${def.table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map(k => data[k]));
  }
  for (const {def, updates} of plans) for (const {row, previous, stored:original} of updates) {
    const baseline = mapped(previous, def, mediaColumns, buckets);
    const old = mapped(original, def, mediaColumns, buckets), data = mapped(row, def, mediaColumns, buckets);
    const changed = Object.keys(data).filter(k => k !== def.key && !isDeepStrictEqual(data[k], baseline[k]));
    if (!changed.length) continue;
    // Lifecycle/ownership checks prevent a stale Studio edit from altering an
    // already-submitted release. Independent field edits can still merge.
    const lifecycleReview = def.collection === "releases" && row.status !== previous.status;
    const guards = [...new Set([def.key, ...changed, ...Object.keys(old).filter(k => lifecycleReview || ["status", "role"].includes(k) || k.endsWith("_id"))])]
      .filter(k => !["updated_at", "last_active_at"].includes(k));
    const values = changed.map(k => data[k]);
    const set = changed.map((k, i) => `${k} = ${["updated_at", "last_active_at"].includes(k) ? `greatest(${k}, $${i + 1})` : `$${i + 1}`}`).join(", ");
    const where = guards.map(k => { values.push(old[k] ?? null); return `${comparisonColumn(k)} is not distinct from $${values.length}`; }).join(" and ");
    const result = await client.query(`update tesohub_music.${def.table} set ${set} where ${where} returning ${def.key}`, values);
    if (result.rowCount !== 1) throw new WriteConflict();
  }
  // Reflect generated IDs only after COMMIT so route response objects retain
  // their identity and a failed transaction cannot leak phantom IDs to callers.
  return () => {
    for (const {def, inserts, updates} of plans) for (const entry of [...inserts, ...updates]) {
      Object.assign(entry.original, entry.row);
      if (def.collection === "platformSettings") Object.assign(after.platformSettings, entry.row);
    }
  };
}
