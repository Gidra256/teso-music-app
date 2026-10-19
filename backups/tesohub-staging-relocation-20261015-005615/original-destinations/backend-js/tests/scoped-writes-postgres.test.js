import assert from "node:assert/strict";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import pg from "pg";
import { createSupabasePersistence } from "../supabasePersistence.js";

const root = new URL("../", import.meta.url);
const clone = structuredClone;
const buckets = {audio:"music-audio", artwork:"artwork", avatars:"avatars", supportAttachments:"support-attachments"};
const fixtureOptions = {
  databaseUrl:"postgres://fixture.invalid/unused", supabaseUrl:"https://fixture.invalid", secretKey:"fixture-only",
  buckets, storageUrlFor:(bucket, path) => `/api/storage/${bucket}/${path}`,
  storageFetch:async () => { throw new Error("External Storage is forbidden in local database tests"); },
};

function latch() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}

async function until(check, message) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail(message);
}

test("P0-C real PostgreSQL independent-session release gate", {skip:!process.env.TESO_P0C_POSTGRES_PORT, timeout:90000}, async t => {
  // Never read DATABASE_URL: this harness creates/drops only its own loopback DB.
  const port = Number(process.env.TESO_P0C_POSTGRES_PORT);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const connection = {host:"127.0.0.1", port, user:"p0c_fixture", password:"", ssl:false, connectionTimeoutMillis:5000, statement_timeout:12000};
  const database = `p0c_gate_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({...connection, database:"postgres"});
  await admin.connect();
  const pools = [], controls = [];
  let observer, created = false;
  t.after(async () => {
    controls.forEach(c => c.release.resolve());
    await Promise.all(pools.map(p => p.end()));
    if (observer) await observer.end();
    if (created) await admin.query(`drop database ${database}`);
    await admin.end();
  });
  await admin.query(`create database ${database}`);
  created = true;
  observer = new pg.Client({...connection, database, application_name:"p0c-observer"});
  await observer.connect();
  await observer.query("create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])");
  for (const file of ["001_supabase_initial.sql", "004_support_v1.sql"]) {
    await observer.query(fs.readFileSync(new URL(`migrations/${file}`, root), "utf8"));
  }
  function instance(name) {
    const raw = new pg.Pool({...connection, database, max:1, application_name:name});
    pools.push(raw);
    let hook = null;
    const target = {
      query:(...args) => raw.query(...args),
      connect:async () => {
        const client = await raw.connect();
        return {
          query:async (sql, values) => {
            const result = await client.query(sql, values);
            if (hook) await hook(sql, result);
            return result;
          },
          release:() => client.release(),
        };
      },
    };
    return {
      raw, p:createSupabasePersistence({...fixtureOptions, poolFactory:() => target}),
      hold(pattern) {
        const entered = latch(), release = latch();
        const control = {entered, release}; controls.push(control);
        hook = async (sql, result) => {
          if (!pattern.test(sql)) return;
          hook = null;
          entered.resolve(result);
          await release.promise;
        };
        return control;
      },
    };
  }
  const a = instance("p0c-client-a"), b = instance("p0c-client-b");
  const pidA = (await a.raw.query("select pg_backend_pid() as pid")).rows[0].pid;
  const pidB = (await b.raw.query("select pg_backend_pid() as pid")).rows[0].pid;
  const pidObserver = (await observer.query("select pg_backend_pid() as pid")).rows[0].pid;
  assert.equal(new Set([pidA, pidB, pidObserver]).size, 3);
  t.diagnostic(`PostgreSQL ${(await observer.query("show server_version")).rows[0].server_version}; distinct backend PIDs ${pidA}, ${pidB}, ${pidObserver}; independent pools, no serializing mutex`);
  const tables = (await observer.query("select tablename from pg_tables where schemaname='tesohub_music'")).rows.map(r => `tesohub_music.${r.tablename}`);
  async function reset() {
    await observer.query(`truncate ${tables.join(",")} restart identity cascade;
      insert into tesohub_music.listeners(name,email) values ('Listener A','a@fixture.invalid'),('Listener B','b@fixture.invalid');
      insert into tesohub_music.artists(name) values ('Artist A'),('Artist B');
      insert into tesohub_music.songs(artist_id,title,audio_path) values (1,'Song A','fixture/a.mp3'),(2,'Song B','fixture/b.mp3');
      insert into tesohub_music.platform_settings(id) values (1);`);
  }
  const rows = async table => (await observer.query(`select * from tesohub_music.${table} order by 1`)).rows;
  const waitLocked = pid => until(async () => (await observer.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0]?.wait_event_type === "Lock", "Second PostgreSQL session must actually contend for a database lock");
  async function check(name, run) { await t.test(name, async () => { await reset(); await run(); }); }
  async function heldWrite(instance, before, after, run) {
    const gate = instance.hold(/^update tesohub_music\.artists /);
    const write = instance.p.saveChanges(before, after);
    try {
      await Promise.race([gate.entered.promise, write.then(() => assert.fail("Expected held artist update"))]);
      await run();
    } finally {
      gate.release.resolve();
      await write;
    }
  }

  await check("A: different records commit on independent connections during an open transaction", async () => {
    const base = await a.p.loadDb(), aa = clone(base), bb = clone(base);
    aa.artists[0].name = "Admin A"; bb.artists[1].name = "Admin B";
    await heldWrite(a, base, aa, async () => {
      await b.p.saveChanges(base, bb);
      assert.deepEqual((await rows("artists")).map(r => r.name), ["Artist A", "Admin B"]);
    });
    assert.deepEqual((await rows("artists")).map(r => r.name), ["Admin A", "Admin B"]);
  });

  for (const sameField of [false, true]) {
    await check(sameField ? "C: same field waits on database lock then rejects stale write" : "B: different fields wait on database lock then merge", async () => {
      const base = await a.p.loadDb(), aa = clone(base), bb = clone(base);
      aa.artists[0].name = "Winner";
      bb.artists[0][sameField ? "name" : "bio"] = "Second edit";
      bb.adminAuditLogs.push({id:10, action:"second_edit"});
      let second;
      await heldWrite(a, base, aa, async () => {
        second = b.p.saveChanges(base, bb).then(() => ({ok:true}), error => ({error}));
        await waitLocked(pidB);
      });
      const result = await second;
      if (sameField) assert.equal(result.error?.code, "STALE_WRITE");
      else assert.equal(result.ok, true);
      const artist = (await rows("artists"))[0];
      assert.equal(artist.name, "Winner");
      assert.equal(artist.bio, sameField ? "" : "Second edit");
      assert.equal((await rows("admin_audit_logs")).length, sameField ? 0 : 1);
    });
  }

  await check("D: follow/like/playlist add and remove survive overlapping stale Admin catalog writes", async () => {
    const base = await a.p.loadDb(), next = clone(base); next.artists[1].name = "Edited";
    let playlist;
    await heldWrite(a, base, next, async () => {
      await b.p.followArtist({listenerId:1, artistId:1});
      await b.p.likeSong({listenerId:1, songId:1});
      playlist = await b.p.createPlaylist({listenerId:1, name:"Fixture playlist"});
      await b.p.addSongToPlaylist({listenerId:1, playlistId:playlist.id, songId:1});
    });
    for (const table of ["artist_follows", "song_likes", "playlists", "playlist_songs"]) assert.equal((await rows(table)).length, 1);
    const stale = await a.p.loadDb(), edited = clone(stale); edited.artists[1].bio = "Another edit";
    await heldWrite(a, stale, edited, async () => {
      await b.p.unfollowArtist({listenerId:1, artistId:1});
      await b.p.unlikeSong({listenerId:1, songId:1});
      await b.p.removeSongFromPlaylist({listenerId:1, playlistId:playlist.id, songId:1});
      await b.p.updatePlaylist({listenerId:1, playlistId:playlist.id, name:"Renamed"});
    });
    for (const table of ["artist_follows", "song_likes", "playlist_songs"]) assert.equal((await rows(table)).length, 0);
    assert.equal((await rows("playlists"))[0].name, "Renamed");
  });

  await check("E: artist release/application and account linkage survive concurrent Admin content edit", async () => {
    const base = await a.p.loadDb(), adminEdit = clone(base), artistEdit = clone(base);
    adminEdit.artists[1].name = "Admin content edit";
    artistEdit.releases.push({id:99, artist:1, listener:1, title:"Draft fixture", status:"draft"});
    artistEdit.artistApplications.push({id:99, listener:2, artist_name:"Applicant", status:"pending"});
    artistEdit.listeners[1].role = "artist_pending"; artistEdit.listeners[1].artist_application_id = 99;
    await heldWrite(a, base, adminEdit, () => b.p.saveChanges(base, artistEdit));
    assert.equal((await rows("releases"))[0].title, "Draft fixture");
    assert.equal((await rows("listeners"))[1].artist_application_id, (await rows("artist_applications"))[0].id);
    assert.equal((await rows("artists"))[1].name, "Admin content edit");
  });

  await check("F: failure after inserts, audit and first update rolls back the whole workflow", async () => {
    const base = await a.p.loadDb(), next = clone(base);
    next.releases.push({id:99, artist:1, listener:1, title:"Must roll back", status:"draft"});
    next.adminAuditLogs.push({id:99, action:"must_roll_back"});
    next.artists[0].name = "Must roll back";
    next.songs[0].title = "Conflicting title";
    const gate = a.hold(/^update tesohub_music\.artists /);
    const write = a.p.saveChanges(base, next).then(() => ({ok:true}), error => ({error}));
    try {
      await gate.entered.promise;
      assert.equal((await rows("releases")).length, 0);
      assert.equal((await rows("admin_audit_logs")).length, 0);
      await b.raw.query("update tesohub_music.songs set title='Independent committed edit' where id=1");
    } finally { gate.release.resolve(); }
    assert.equal((await write).error?.code, "STALE_WRITE");
    assert.equal((await rows("releases")).length, 0);
    assert.equal((await rows("admin_audit_logs")).length, 0);
    assert.deepEqual((await rows("artists")).map(r => r.name), ["Artist A", "Artist B"]);
    assert.deepEqual((await rows("songs")).map(r => r.title), ["Independent committed edit", "Song B"]);
    assert.equal(next.releases[0].id, 99);
  });

  await check("G: overlapping scheduled publishers create one public song and consistent release", async () => {
    await observer.query(`update tesohub_music.listeners set role='artist', artist_id=1 where id=1;
      update tesohub_music.artists set owner_listener_id=1 where id=1;
      insert into tesohub_music.releases(artist_id,listener_id,title,status,release_date,audio_path,cover_path,genre,language,rights_confirmed,approved_at)
      values (1,1,'Due fixture','scheduled',current_date,'fixture/due.mp3','fixture/art.png','Gospel','Ateso',true,now())`);
    // Hold the first publisher inside its actual SQL statement, after locking
    // the due release. The other real session must SKIP LOCKED, not duplicate it.
    await observer.query(`create function tesohub_music.p0c_publication_barrier() returns trigger language plpgsql as $$
      begin if new.source_release_id is not null then perform pg_advisory_xact_lock(18473, 921); end if; return new; end $$;
      create trigger p0c_publication_barrier before insert on tesohub_music.songs for each row execute function tesohub_music.p0c_publication_barrier();`);
    await observer.query("select pg_advisory_lock(18473,921)");
    let first, second;
    try {
      first = a.p.publishDueReleases().then(() => ({ok:true}), error => ({error}));
      await waitLocked(pidA);
      assert.match((await observer.query("select query from pg_stat_activity where pid=$1", [pidA])).rows[0].query, /with due as/);
      second = b.p.publishDueReleases().then(() => ({ok:true}), error => ({error}));
      assert.equal((await second).ok, true);
      assert.equal((await rows("songs")).length, 2);
    } finally {
      await observer.query("select pg_advisory_unlock(18473,921)");
      if (first) assert.equal((await first).ok, true);
      if (second) await second;
      await observer.query("drop trigger p0c_publication_barrier on tesohub_music.songs; drop function tesohub_music.p0c_publication_barrier()");
    }
    const release = (await rows("releases"))[0], songs = await rows("songs");
    assert.equal(songs.length, 3);
    assert.equal(release.status, "published");
    assert.equal(songs.filter(s => s.source_release_id === release.id).length, 1);
    assert.equal(songs.find(s => s.source_release_id === release.id).id, release.public_song_id);
    await Promise.all([a.p.publishDueReleases(), b.p.publishDueReleases()]);
    assert.equal((await rows("songs")).length, 3);
  });

  await check("generated IDs and cyclic references remain unique across overlapping workflows", async () => {
    const base = await a.p.loadDb(), aa = clone(base), bb = clone(base);
    for (const [db, name] of [[aa,"New A"], [bb,"New B"]]) {
      db.artists.push({id:3, name, status:"active"});
      db.songs.push({id:3, artist:3, title:name, status:"published", source_release_id:1});
      db.releases.push({id:1, artist:3, listener:1, title:name, status:"published", public_song:3});
      db.adminAuditLogs.push({id:1, action:"publish", target_type:"artist", target_id:3, details:{artist_id:3,public_song:3}});
    }
    const gate = a.hold(/^insert into tesohub_music\.admin_audit_logs /);
    const first = a.p.saveChanges(base, aa);
    try { await gate.entered.promise; await b.p.saveChanges(base, bb); }
    finally { gate.release.resolve(); await first; }
    assert.notEqual(aa.artists[2].id, bb.artists[2].id);
    const songs = await rows("songs");
    for (const release of await rows("releases")) {
      const song = songs.find(s => s.id === release.public_song_id);
      assert.equal(song.artist_id, release.artist_id); assert.equal(song.source_release_id, release.id);
    }
    for (const audit of await rows("admin_audit_logs")) {
      assert.equal(audit.details.artist_id, Number(audit.target_id));
      assert.equal(Number(songs.find(s => Number(s.id) === audit.details.public_song).artist_id), audit.details.artist_id);
    }
  });

  await check("failed save after upload leaves only an orphan, never a wrong-owner reference or publication", async () => {
    await observer.query("insert into tesohub_music.releases(artist_id,listener_id,title,status,audio_path) values (1,1,'Private fixture','draft','fixture/existing.mp3')");
    const existingObject = {bytes:"existing fixture bytes", type:"audio/mpeg"};
    const objects = new Map([["fixture/existing.mp3", clone(existingObject)]]);
    const requests = [];
    const mock = t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(options.method, "POST");
      assert.equal(options.headers["x-upsert"], "false");
      const key = new URL(url).pathname.split("/music-audio/")[1];
      assert.ok(key && !objects.has(key));
      objects.set(key, {bytes:options.body.toString(), type:options.headers["content-type"]});
      requests.push(key);
      return {ok:true};
    });
    try {
      const base = await a.p.loadDb(), after = clone(base);
      after.releases[0].audio_file = await a.p.uploadFile({fieldname:"audio_upload", originalname:"fixture.mp3", mimetype:"audio/mpeg", buffer:Buffer.from("new synthetic bytes")});
      after.adminAuditLogs.push({id:99, action:"must_not_commit"});
      // Ownership changes in a second session after authorization/read/upload.
      await b.raw.query("update tesohub_music.releases set artist_id=2, listener_id=2 where id=1");
      await assert.rejects(a.p.saveChanges(base, after), error => error.code === "STALE_WRITE");
      const release = (await rows("releases"))[0];
      assert.equal(Number(release.artist_id), 2);
      assert.equal(release.audio_path, "fixture/existing.mp3");
      assert.equal(release.status, "draft"); assert.equal(release.public_song_id, null);
      assert.equal((await rows("songs")).length, 2);
      assert.equal((await rows("admin_audit_logs")).length, 0);
      assert.equal(requests.length, 1); assert.equal(objects.size, 2);
      assert.deepEqual(objects.get("fixture/existing.mp3"), existingObject);
      assert.ok(!(await rows("releases")).some(row => row.audio_path === requests[0]));
      assert.ok(!(await rows("songs")).some(row => row.audio_path === requests[0]));
    } finally { mock.mock.restore(); }
  });
});

test("uploads are create-only and never delete an existing object on conflict", async t => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({url, options});
    return {ok:requests.length === 1, status:409, text:async () => "Object already exists"};
  });
  const p = createSupabasePersistence(fixtureOptions);
  const file = {fieldname:"audio_upload", originalname:"same-name.mp3", mimetype:"audio/mpeg", buffer:Buffer.from("synthetic test bytes")};
  const uploaded = await p.uploadFile(file);
  await assert.rejects(p.uploadFile(file), /409/);
  assert.ok(uploaded.startsWith("/api/storage/music-audio/songs/audio/"));
  assert.notEqual(requests[0].url, requests[1].url);
  assert.ok(requests.every(r => r.options.method === "POST" && r.options.headers["x-upsert"] === "false"));
  assert.equal(requests.length, 2);
});
