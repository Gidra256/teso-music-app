import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { createSupabasePersistence } from "../supabasePersistence.js";
import { AUDIO_COOKIE, AUDIO_COOKIE_SECONDS, audioResponseUrl, canReadAudio, makeAudioCookie,
  normalizeAudioInput, publicExternalAudio, storageAudioPath, validAudioCookie, validAudioId, validObjectPath } from "../audioAccess.js";

const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const persistenceSource = fs.readFileSync(new URL("../supabasePersistence.js", import.meta.url), "utf8");
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const token = "fixture-admin-token";
const secret = "fixture-storage-secret";
const audio = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");

function authHarness(role = "content_admin") {
  const roleStart = serverSource.indexOf("const ADMIN_ROLES =");
  const roleEnd = serverSource.indexOf("};", serverSource.indexOf("const ADMIN_ROLE_PERMISSIONS =")) + 2;
  const fnStart = serverSource.indexOf("function configuredAdminRole()");
  const fnEnd = serverSource.indexOf("function requireAdminPermission", fnStart);
  const audioStart = serverSource.indexOf("function audioAccessFor(");
  const audioEnd = serverSource.indexOf("function mediaPath(", audioStart);
  const ctx = vm.createContext({
    process: { env: { ADMIN_ROLE: role } }, ADMIN_TOKEN: token, ADMIN_USERNAME: "fixture",
    AUDIO_COOKIE, AUDIO_COOKIE_SECONDS, validAudioCookie, makeAudioCookie,
    cleanText: (value) => String(value || "").trim(), hashToken,
    getBearerToken: (req) => (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim(),
  });
  vm.runInContext(serverSource.slice(roleStart, roleEnd) + serverSource.slice(fnStart, fnEnd) +
    serverSource.slice(audioStart, audioEnd), ctx);
  return ctx;
}

async function fixture(t, role = "content_admin") {
  const queries = [], fetches = [];
  let privateBucket = true;
  const records = [
    { kind: "song", id: 1, artist_id: 10, artist_status: "active", status: "published", audio_path: "songs/public.mp3", is_public: true },
    ...["draft", "under_review", "rejected", "approved", "scheduled", "published"].map((status, index) => ({
      kind: "release", id: index + 2, artist_id: 10, artist_status: "active", status,
      audio_path: `releases/${status}.mp3`, is_public: false,
    })),
    { kind: "song", id: 8, artist_id: 10, artist_status: "active", status: "hidden", audio_path: "songs/hidden.mp3", is_public: false },
    { kind: "song", id: 9, artist_id: 10, artist_status: "active", status: "removed", audio_path: "songs/removed.mp3", is_public: false },
  ];
  const principals = {
    [hashToken("listener")]: { viewer_role: "listener", viewer_status: "active", viewer_artist_id: null },
    [hashToken("owner")]: { viewer_role: "artist", viewer_status: "active", viewer_artist_id: 10 },
    [hashToken("other-artist")]: { viewer_role: "artist", viewer_status: "active", viewer_artist_id: 20 },
    [hashToken("suspended-owner")]: { viewer_role: "artist", viewer_status: "suspended", viewer_artist_id: 10 },
    [hashToken("pending")]: { viewer_role: "artist_pending", viewer_status: "active", viewer_artist_id: 10 },
  };
  const pool = { connect: async () => pool, query: async (sql, params) => {
    assert.doesNotMatch(sql, /\b(update|insert|delete)\b/i, "audio lookup must never publish or write sessions");
    assert.match(sql, /storage\.buckets where id = \$3 and public = false/);
    assert.match(sql, /token_hash = \$2/);
    queries.push({ sql, params });
    if (!privateBucket) return { rows: [] };
    const object = sql.includes("audio_path = $1");
    const kind = sql.includes("where song.id = $1") ? "song" : "release";
    return { rows: records.filter((r) => object ? r.audio_path === params[0] :
      r.kind === kind && String(r.id) === params[0]).map((r) => ({ ...r, ...principals[params[1]] })) };
  } };
  const persistence = createSupabasePersistence({
    databaseUrl: "postgres://fixture.invalid/unused", supabaseUrl: "https://fixture.supabase.co", secretKey: secret,
    buckets: { audio: "music-audio", artwork: "artwork", avatars: "avatars", supportAttachments: "support-attachments" },
    storageUrlFor: (bucket, path) => `/api/storage/${bucket}/${path}`, poolFactory: () => pool,
    storageFetch: async (url, options) => {
      fetches.push({ url, options });
      assert.equal(options.headers.authorization, `Bearer ${secret}`);
      assert.equal(options.redirect, "error");
      const match = /^bytes=(\d+)-(\d*)$/.exec(options.headers.range || "");
      const headers = { "content-type": "audio/mpeg", "accept-ranges": "bytes", "cache-control": "public, max-age=3600" };
      if (match) {
        const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), audio.length - 1) : audio.length - 1;
        if (start >= audio.length) return new Response(null, { status: 416, headers: { "content-range": `bytes */${audio.length}` } });
        headers["content-range"] = `bytes ${start}-${end}/${audio.length}`;
        headers["content-length"] = String(end - start + 1);
        return new Response(audio.subarray(start, end + 1), { status: 206, headers });
      }
      headers["content-length"] = String(audio.length);
      return new Response(audio, { status: 200, headers });
    },
  });
  const auth = authHarness(role);
  const app = express();
  // Supply a synthetic resolved principal for the P0-A stream authorization matrix.
  // Real staff session/preview revocation is covered by admin-accounts.test.js.
  app.use((req,res,next)=>{
    const bearer=(req.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    const preview=(req.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(`${AUDIO_COOKIE}=`))?.slice(AUDIO_COOKIE.length+1);
    if(bearer===token||(!bearer&&req.get("sec-fetch-site")!=="cross-site"&&validAudioCookie(preview,token))) req.adminIdentity=auth.publicAdminUser();
    next();
  });
  app.get("/api/storage/:bucket/*", (req, res, next) => persistence.streamObject(req, res, auth.audioAccessFor(req)).catch(next));
  for (const kind of ["song", "release"]) {
    app.get(`/api/${kind}s/:id/audio/`, (req, res, next) =>
      persistence.streamAudio({ kind, value: req.params.id }, req, res, auth.audioAccessFor(req)).catch(next));
  }
  app.use((error, req, res, next) => res.status(500).json({ detail: "Something went wrong." }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const get = (path, identity, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: { ...(identity ? { authorization: `Bearer ${identity}` } : {}), ...headers }, redirect: "manual",
  });
  return { get, records, queries, fetches, setPrivate: (value) => { privateBucket = value; } };
}

test("A/B: guests and ordinary listeners stream published audio without registration", async (t) => {
  const f = await fixture(t);
  for (const identity of [undefined, "listener"]) {
    const r = await f.get("/api/songs/1/audio/", identity);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), audio.toString());
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(f.queries.length, 2, "one read-only authorization query per request");
});

test("C/D/F: guests, listeners, different artists and forged client ownership cannot preview any non-public release state", async (t) => {
  const f = await fixture(t);
  for (const row of f.records.filter((r) => r.kind === "release")) {
    for (const identity of [undefined, "listener", "other-artist", "pending", "suspended-owner", "invalid-token"]) {
      const r = await f.get(`/api/releases/${row.id}/audio/?artist_id=10&user_id=10`, identity);
      assert.equal(r.status, 404, `${identity}: ${row.status}`);
      assert.deepEqual(await r.json(), { detail: "Media not found." });
    }
  }
  assert.equal(f.fetches.length, 0, "denial must happen before storage access");
});

test("E: active owning artist can preview own canonical release states; suspended artist cannot", async (t) => {
  const f = await fixture(t);
  for (const row of f.records.filter((r) => r.kind === "release")) {
    const r = await f.get(`/api/releases/${row.id}/audio/`, "owner");
    assert.equal(r.status, 200, row.status); await r.arrayBuffer();
  }
  f.records[1].artist_status = "suspended";
  assert.equal((await f.get("/api/releases/2/audio/", "owner")).status, 404);
});

test("G/H: releases permission previews releases; support/moderator cannot preview private releases", async (t) => {
  for (const role of ["content_admin", "super_admin", "moderator", "support_admin"]) {
    const f = await fixture(t, role);
    const response = await f.get("/api/releases/3/audio/", token);
    assert.equal(response.status, ["content_admin", "super_admin"].includes(role) ? 200 : 404, role);
    await response.arrayBuffer();
    const catalog = await f.get("/api/songs/8/audio/", token);
    assert.equal(catalog.status, role === "support_admin" ? 404 : 200, `${role} catalog`);
    await catalog.arrayBuffer();
  }
});

test("I: malformed/missing IDs and unknown objects return the same safe failure without storage access", async (t) => {
  const f = await fixture(t);
  for (const id of ["0", "-1", "oops", "1e2", "9007199254740993", "999999"]) {
    const r = await f.get(`/api/releases/${id}/audio/`, "owner");
    assert.equal(r.status, 404); assert.equal(await r.text(), '{"detail":"Media not found."}');
  }
  assert.equal((await f.get("/api/storage/music-audio/unknown.mp3", token)).status, 404);
  assert.equal(f.fetches.length, 0);
});

test("J/K: public, artist and reviewer Range requests preserve 206, seeking bytes, length and Content-Range", async (t) => {
  const f = await fixture(t);
  for (const [path, identity] of [["/api/songs/1/audio/", undefined], ["/api/releases/2/audio/", "owner"], ["/api/releases/3/audio/", token]]) {
    const r = await f.get(path, identity, { Range: "bytes=10-19" });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), `bytes 10-19/${audio.length}`);
    assert.equal(r.headers.get("content-length"), "10");
    assert.equal(r.headers.get("accept-ranges"), "bytes");
    assert.equal(await r.text(), audio.subarray(10, 20).toString());
  }
  const invalid = await f.get("/api/songs/1/audio/", undefined, { Range: "bytes=999-" });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), `bytes */${audio.length}`);
  assert.equal(await invalid.text(), "");
});

test("old object URLs are protected too; hidden/removed and due-but-scheduled content stay private", async (t) => {
  const f = await fixture(t);
  for (const row of f.records.filter((r) => !r.is_public)) {
    assert.equal((await f.get(`/api/storage/music-audio/${row.audio_path}`)).status, 404);
  }
  const publicResponse = await f.get("/api/storage/music-audio/songs/public.mp3", undefined, { Range: "bytes=0-3" });
  assert.equal(publicResponse.status, 206); assert.equal(await publicResponse.text(), "0123");
  f.records[0].is_public = false; f.records[0].status = "hidden";
  assert.equal((await f.get("/api/storage/music-audio/songs/public.mp3")).status, 404);
  assert.equal(f.fetches.length, 1);
});

test("L: serializers return opaque backend routes, never raw/signed storage URLs", () => {
  for (const raw of ["https://fixture.supabase.co/storage/v1/object/sign/music-audio/private.mp3?token=SECRET", "/api/storage/music-audio/private.mp3"]) {
    for (const kind of ["song", "release"]) {
      const value = audioResponseUrl({}, kind, { id: 2, audio_file: raw }, (_, value) => `https://api.example.test${value}`);
      assert.equal(value, `https://api.example.test/api/${kind}s/2/audio/`);
      assert.doesNotMatch(value, /SECRET|storage|private\.mp3/);
    }
  }
  assert.equal(audioResponseUrl({}, "song", { id: 2, audio_file: "" }, (_, v) => v), "");
  assert.ok(!serverSource.includes("audio_file: absoluteUrl(req,"));
});

test("storage stays private; failures and successful streams never expose upstream secrets or signed URLs", async (t) => {
  const f = await fixture(t);
  f.setPrivate(false);
  assert.equal((await f.get("/api/songs/1/audio/")).status, 404);
  assert.equal(f.fetches.length, 0);
  f.setPrivate(true);
  const r = await f.get("/api/releases/2/audio/", "owner");
  assert.doesNotMatch(JSON.stringify([...r.headers]), /fixture-storage-secret|supabase|token=/);
  assert.equal(r.headers.get("location"), null); await r.arrayBuffer();
  const migration = fs.readFileSync(new URL("../migrations/001_supabase_initial.sql", import.meta.url), "utf8");
  assert.match(migration, /'music-audio',\s*'music-audio',\s*false/);
});

test("signed legacy Supabase media is resolved server-side; private external URLs fail closed", async (t) => {
  const f = await fixture(t);
  f.records[1].audio_path = null;
  f.records[1].legacy_audio_file = "https://fixture.supabase.co/storage/v1/object/sign/music-audio/private.mp3?token=OLDSECRET";
  const r = await f.get("/api/releases/2/audio/", "owner");
  assert.equal(r.status, 200); await r.arrayBuffer();
  assert.equal(f.fetches[0].url, "https://fixture.supabase.co/storage/v1/object/music-audio/private.mp3");
  f.records[1].legacy_audio_file = "https://external.example.test/private.mp3";
  assert.equal((await f.get("/api/releases/2/audio/", "owner")).status, 404);
  assert.equal(f.fetches.length, 1);
});

test("audio-only browser credential expires, cannot be forged, and obeys current role/bearer precedence", async (t) => {
  const cookie = makeAudioCookie(token);
  assert.equal(validAudioCookie(cookie, token), true);
  assert.equal(validAudioCookie(cookie, "different-key"), false);
  assert.equal(validAudioCookie(cookie, token, Date.now() + AUDIO_COOKIE_SECONDS * 1000 + 1000), false);
  assert.equal(validAudioCookie(`99999999999.${"0".repeat(64)}`, token), false);
  const f = await fixture(t);
  const headers = { cookie: `${AUDIO_COOKIE}=${cookie}` };
  const r = await f.get("/api/releases/2/audio/", undefined, { ...headers, Range: "bytes=5-9" });
  assert.equal(r.status, 206); assert.equal(await r.text(), "56789");
  assert.equal((await f.get("/api/releases/2/audio/", "listener", headers)).status, 404);
  assert.equal((await f.get("/api/releases/2/audio/", undefined, { ...headers, "sec-fetch-site": "cross-site" })).status, 404);
  const support = await fixture(t, "support_admin");
  assert.equal((await support.get("/api/releases/2/audio/", undefined, headers)).status, 404);
  assert.match(serverSource, /httpOnly: true, secure: req.secure, sameSite: "strict", path: "\/api\/"/);
});

test("SQL enforces published state, source release and verified account relationship without scheduled publication", () => {
  const sql = persistenceSource.slice(persistenceSource.indexOf("  async function audioCandidates("), persistenceSource.indexOf("  async function streamAudio("));
  assert.match(sql, /song.status = 'published'/);
  assert.match(sql, /source.status = 'published' and source.public_song_id = song.id/);
  assert.match(sql, /release.status = 'published'/);
  assert.match(sql, /published.audio_path = release.audio_path/);
  assert.match(sql, /viewer.artist_id as viewer_artist_id/);
  assert.match(sql, /auth_tokens where token_hash = \$2/);
  assert.doesNotMatch(sql, /await publishDueReleases|loadDbWithPublishedReleases|last_active_at/);
  const owner = { kind: "release", status: "draft", artist_id: 10, artist_status: "active", viewer_role: "artist", viewer_status: "active", viewer_artist_id: 10 };
  assert.equal(canReadAudio(owner), true);
  assert.equal(canReadAudio({ ...owner, status: "made-up" }), false);
  assert.equal(canReadAudio({ ...owner, viewer_artist_id: 20 }), false);
});

test("path validation and remote URL handling reject traversal, signed redirects and credential leaks", () => {
  for (const path of ["../private.mp3", "a/../b", "a\\b", "a//b", "a/%2e%2e/b", "a?token=x", "a#b", ""]) assert.equal(validObjectPath(path), false);
  for (const id of [0, -1, "1e2", "1.5", "9007199254740993"]) assert.equal(validAudioId(id), false);
  assert.equal(storageAudioPath("/api/storage/music-audio/a%2Fb.mp3", "music-audio", ""), "a/b.mp3");
  assert.equal(storageAudioPath("https://attacker.test/storage/v1/object/music-audio/a.mp3", "music-audio", "https://fixture.supabase.co"), null);
  for (const url of ["https://fixture.supabase.co/storage/v1/object/music-audio/a.mp3", "https://cdn.test/a.mp3?token=secret", "http://cdn.test/a.mp3", "https://name:secret@cdn.test/a.mp3"]) assert.equal(publicExternalAudio(url, "https://fixture.supabase.co"), null);
  assert.equal(publicExternalAudio("https://cdn.test/public.mp3", ""), "https://cdn.test/public.mp3");
});

test("legacy local upload mounts are no longer unguarded, and Admin metadata edits preserve original audio", () => {
  assert.doesNotMatch(serverSource, /app.use\("\/(uploads|media)", express.static/);
  const legacy = serverSource.slice(serverSource.indexOf("async function serveLegacyMedia("), serverSource.indexOf("async function serveAudio("));
  assert.match(legacy, /if \(USE_SUPABASE_PERSISTENCE/);
  assert.match(legacy, /canReadAudio/);
  assert.doesNotMatch(legacy, /saveDb|publishDueReleases/);
  assert.ok(serverSource.includes('mediaPath(req.body.audio_file) === `/api/songs/${song.id}/audio/`'));
});

test("audio URL input strips legacy Supabase signatures before persistence and rejects credential-bearing external URLs", () => {
  const config = { bucket: "music-audio", supabaseUrl: "https://fixture.supabase.co" };
  assert.equal(normalizeAudioInput("https://fixture.supabase.co/storage/v1/object/sign/music-audio/a.mp3?token=SECRET", config), "/api/storage/music-audio/a.mp3");
  assert.equal(normalizeAudioInput("https://external.test/a.mp3?token=SECRET", config), null);
  assert.equal(normalizeAudioInput("/uploads/songs/audio/a.mp3", config), null);
  assert.equal(normalizeAudioInput("https://external.test/public.mp3", config), "https://external.test/public.mp3");
});
