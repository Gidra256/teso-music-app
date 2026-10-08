import crypto from "node:crypto";

export const PRIVATE_RELEASE_STATUSES = new Set([
  "draft", "under_review", "rejected", "approved", "scheduled", "published",
]);
const SONG_STATUSES = new Set(["published", "hidden", "removed", "under_review"]);
export const AUDIO_COOKIE = "tesohub_audio_preview";
export const AUDIO_COOKIE_SECONDS = 15 * 60;

export function validAudioId(value) {
  return /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
}

export function validObjectPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 &&
    !/[\\\x00-\x1f\x7f?#%]/.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..");
}

export function audioResponseUrl(req, kind, record, absoluteUrl) {
  return record.audio_file && validAudioId(record.id)
    ? absoluteUrl(req, `/api/${kind === "release" ? "releases" : "songs"}/${record.id}/audio/`)
    : "";
}

export function canReadAudio(row, reviewer = {}) {
  if (row.is_public === true) return true;
  if (row.kind === "song") {
    return SONG_STATUSES.has(row.status) && Boolean(reviewer.catalog);
  }
  if (row.kind !== "release" || !PRIVATE_RELEASE_STATUSES.has(row.status)) return false;
  if (reviewer.releases) return true;
  return row.viewer_role === "artist" && row.viewer_status === "active" &&
    row.artist_status === "active" && Number(row.viewer_artist_id) > 0 &&
    Number(row.viewer_artist_id) === Number(row.artist_id);
}

// A browser media element cannot attach a bearer header. This grants ONLY audio
// previews; every request still checks current server-side review permissions.
export function makeAudioCookie(secret, now = Date.now()) {
  const expiry = String(Math.floor(now / 1000) + AUDIO_COOKIE_SECONDS);
  const signature = crypto.createHmac("sha256", secret).update(`audio-preview:${expiry}`).digest("hex");
  return `${expiry}.${signature}`;
}

export function validAudioCookie(value, secret, now = Date.now()) {
  const match = /^(\d+)\.([a-f0-9]{64})$/.exec(String(value || ""));
  if (!match) return false;
  const current = Math.floor(now / 1000);
  if (Number(match[1]) <= current || Number(match[1]) > current + AUDIO_COOKIE_SECONDS) return false;
  const expected = crypto.createHmac("sha256", secret).update(`audio-preview:${match[1]}`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(match[2], "hex"));
}

export function storageAudioPath(value, bucket, supabaseUrl) {
  const raw = String(value || "");
  const proxy = `/api/storage/${encodeURIComponent(bucket)}/`;
  let encoded;
  if (raw.startsWith(proxy)) encoded = raw.slice(proxy.length);
  else {
    try {
      const url = new URL(raw);
      if (url.pathname.startsWith(proxy)) encoded = url.pathname.slice(proxy.length);
      else if (supabaseUrl && url.origin === new URL(supabaseUrl).origin) {
        for (const prefix of ["", "public/", "authenticated/", "sign/"]) {
          const start = `/storage/v1/object/${prefix}${encodeURIComponent(bucket)}/`;
          if (url.pathname.startsWith(start)) encoded = url.pathname.slice(start.length);
        }
      }
    } catch { return null; }
  }
  try {
    const decoded = decodeURIComponent(encoded || "");
    return validObjectPath(decoded) ? decoded : null;
  } catch { return null; }
}

export function publicExternalAudio(value, supabaseUrl) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    if (/\.supabase\.(co|com)$/i.test(url.hostname) ||
        (supabaseUrl && url.origin === new URL(supabaseUrl).origin) ||
        url.pathname.startsWith("/api/") || url.pathname.startsWith("/storage/")) return null;
    return url.href;
  } catch { return null; }
}

export function normalizeAudioInput(value, { bucket, supabaseUrl, allowLocal = false }) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const objectPath = storageAudioPath(raw, bucket, supabaseUrl);
  if (objectPath) return `/api/storage/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  if (allowLocal && /^\/(uploads|media)\//.test(raw) && validObjectPath(raw.slice(1))) return raw;
  return publicExternalAudio(raw, supabaseUrl);
}
