import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import express from "express";
import { createSupabasePersistence } from "../supabasePersistence.js";

// Optional local test engine; it is not an application/native dependency and
// cannot use the production DATABASE_URL. Every record below is synthetic.
test("PostgreSQL executes the real media authorization query against isolated ownership/publication fixtures", {
  skip: !process.env.TESO_AUDIO_PGLITE_MODULE,
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(process.env.TESO_AUDIO_PGLITE_MODULE).href);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema tesohub_music; create schema storage;
    create table storage.buckets (id text primary key, public boolean);
    create table tesohub_music.artists (id bigint primary key, status text);
    create table tesohub_music.listeners (id bigint primary key, role text, status text, artist_id bigint);
    create table tesohub_music.auth_tokens (listener_id bigint, token_hash text);
    create table tesohub_music.songs (id bigint primary key, artist_id bigint, status text, audio_path text, legacy_audio_file text, source_release_id bigint);
    create table tesohub_music.releases (id bigint primary key, artist_id bigint, status text, audio_path text, legacy_audio_file text, public_song_id bigint, release_date date);
    insert into storage.buckets values ('music-audio', false);
    insert into tesohub_music.artists values (10,'active'), (20,'active');
    insert into tesohub_music.listeners values (101,'artist','active',10), (102,'artist','active',20), (103,'listener','active',null), (104,'artist','suspended',10);
    insert into tesohub_music.songs values
      (1,10,'published','songs/public.mp3','',null),
      (2,10,'published','releases/scheduled.mp3','',2),
      (3,10,'under_review','songs/review.mp3','',null),
      (4,10,'published','releases/published.mp3','',3),
      (5,10,'hidden','releases/hidden.mp3','',7),
      (6,10,'removed','songs/removed.mp3','',null);
    insert into tesohub_music.releases values
      (1,10,'draft','releases/draft.mp3','',null,null),
      (2,10,'scheduled','releases/scheduled.mp3','',2,'2000-01-01'),
      (3,10,'published','releases/published.mp3','',4,null),
      (4,10,'rejected','releases/rejected.mp3','',null,null),
      (5,10,'approved','releases/approved.mp3','',null,null),
      (6,10,'under_review','releases/review.mp3','',null,null),
      (7,10,'published','releases/hidden.mp3','',5,null);
  `);
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  for (const [id, value] of [[101,"owner"],[102,"other"],[103,"listener"],[104,"suspended"]]) {
    await db.query("insert into tesohub_music.auth_tokens values ($1,$2)", [id, hash(value)]);
  }
  let reads = 0, storageRequests = 0;
  const pool = { connect: async () => pool, query: (sql, params) => {
    assert.doesNotMatch(sql, /\b(update|insert|delete)\b/i);
    reads++;
    return db.query(sql, params);
  } };
  const persistence = createSupabasePersistence({
    databaseUrl: "fixture-only", supabaseUrl: "https://fixture.invalid", secretKey: "fixture-only",
    buckets: { audio: "music-audio", artwork: "artwork", avatars: "avatars" },
    storageUrlFor: () => "", poolFactory: () => pool,
    storageFetch: async (url, options) => {
      storageRequests++;
      assert.equal(options.headers.range, "bytes=0-3");
      return new Response("0123", { status: 206, headers: {
        "content-range": "bytes 0-3/100", "content-length": "4", "accept-ranges": "bytes", "content-type": "audio/mpeg",
      } });
    },
  });
  const app = express();
  let routeError;
  app.get("/:kind/:id", (req, res, next) => {
    const identity = req.get("authorization") || "";
    const reviewer = identity === "reviewer" ? { releases: true, catalog: true } : identity === "moderator" ? { catalog: true } : {};
    persistence.streamAudio({ kind: req.params.kind, value: req.params.id }, req, res,
      { tokenHash: hash(identity), reviewer }).catch(next);
  });
  app.get("/object/*", (req, res, next) => persistence.streamAudio(
    { kind: "object", value: req.params[0] }, req, res).catch(next));
  app.use((error, req, res, next) => { routeError = error; res.sendStatus(500); });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  async function check(path, identity, expected) {
    const beforeReads = reads, beforeStorage = storageRequests;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { authorization: identity || "", Range: "bytes=0-3" },
    });
    assert.equal(routeError, undefined);
    assert.equal(response.status, expected, `${path}: ${identity || "guest"}`);
    assert.equal(reads - beforeReads, 1);
    assert.equal(storageRequests - beforeStorage, expected === 206 ? 1 : 0);
    if (expected === 206) {
      assert.equal(response.headers.get("content-range"), "bytes 0-3/100");
      assert.equal(await response.text(), "0123");
    } else assert.deepEqual(await response.json(), { detail: "Media not found." });
  }
  for (const identity of ["", "listener", "owner", "other"]) await check("/song/1", identity, 206);
  for (const id of [1,2,4,5,6,7]) {
    for (const identity of ["", "listener", "other", "suspended", "moderator"]) await check(`/release/${id}`, identity, 404);
    await check(`/release/${id}`, "owner", 206);
    await check(`/release/${id}`, "reviewer", 206);
  }
  await check("/song/2", "", 404); // Even a due date in the past does not publish.
  await check("/song/3", "", 404);
  await check("/song/6", "", 404);
  await check("/release/3", "", 206);
  await check("/song/3", "moderator", 206);
  await check("/object/releases/draft.mp3", "", 404);
  await check("/object/songs/public.mp3", "", 206);
  await check("/release/999", "reviewer", 404);
  assert.equal((await db.query("select status from tesohub_music.releases where id=2")).rows[0].status, "scheduled");
  await db.query("update storage.buckets set public=true");
  await check("/song/1", "", 404);
});
