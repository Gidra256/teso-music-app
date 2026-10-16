import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { test } from "node:test";
import { createSongRemovalStore } from "../songRemovalStore.js";

const root = new URL("../", import.meta.url);

test("song-removal migration, ownership, cancellation evidence and due worker", {
  skip: !process.env.TESO_P0C_POSTGRES_PORT,
  timeout: 90000,
}, async (t) => {
  const config = {
    host: "127.0.0.1",
    port: Number(process.env.TESO_P0C_POSTGRES_PORT),
    user: "p0c_fixture",
    password: "",
    ssl: false,
    connectionTimeoutMillis: 5000,
    statement_timeout: 12000,
  };
  const database = `song_removal_gate_${process.pid}_${Date.now()}`;
  const control = new pg.Client({ ...config, database: "postgres" });
  await control.connect();
  await control.query(`create database ${database}`);
  const pool = new pg.Pool({ ...config, database, max: 4 });
  t.after(async () => {
    await pool.end();
    await control.query(`drop database ${database}`);
    await control.end();
  });

  await pool.query("create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])");
  await pool.query(fs.readFileSync(new URL("migrations/001_supabase_initial.sql", root), "utf8"));
  const migration = fs.readFileSync(new URL("migrations/009_song_removal_requests.sql", root), "utf8");
  await pool.query(migration);
  await pool.query(migration);

  const objects = (await pool.query(`select
    to_regclass('tesohub_music.song_removal_requests') requests,
    to_regclass('tesohub_music.song_removal_events') events,
    to_regclass('tesohub_music.song_removal_requests_id_seq') requests_seq,
    to_regclass('tesohub_music.song_removal_events_id_seq') events_seq`)).rows[0];
  assert.ok(Object.values(objects).every(Boolean));
  const rls = (await pool.query(`select relname,relrowsecurity from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='tesohub_music' and relname in ('song_removal_requests','song_removal_events')`)).rows;
  assert.equal(rls.length, 2);
  assert.ok(rls.every((row) => row.relrowsecurity));
  assert.equal((await pool.query(`select count(*)::int count from pg_policies
    where schemaname='tesohub_music' and tablename in ('song_removal_requests','song_removal_events')
      and permissive='RESTRICTIVE'`)).rows[0].count, 2);
  for (const role of ["anon", "authenticated", "service_role"]) {
    if (!(await pool.query("select 1 from pg_roles where rolname=$1", [role])).rowCount) continue;
    assert.equal((await pool.query(`select
      has_table_privilege($1,'tesohub_music.song_removal_requests','SELECT,INSERT,UPDATE,DELETE') allowed`, [role])).rows[0].allowed, false);
    assert.equal((await pool.query(`select
      has_sequence_privilege($1,'tesohub_music.song_removal_requests_id_seq','USAGE,SELECT,UPDATE') allowed`, [role])).rows[0].allowed, false);
  }
  assert.equal((await pool.query(`select count(*)::int count from information_schema.role_table_grants
    where table_schema='tesohub_music' and table_name in ('song_removal_requests','song_removal_events')
      and grantee='PUBLIC'`)).rows[0].count, 0);

  await pool.query(`
    insert into tesohub_music.listeners(name,email,role,status) values
      ('Owner One','owner-one@fixture.invalid','artist','active'),
      ('Owner Two','owner-two@fixture.invalid','artist','active');
    insert into tesohub_music.artists(name,status,owner_listener_id) values
      ('Artist One','active',1),('Artist Two','active',2);
    update tesohub_music.listeners set artist_id=id where id in (1,2);
    insert into tesohub_music.songs(artist_id,title,status) values
      (1,'Owned Song','published'),(2,'Other Song','published');
  `);
  const store = createSongRemovalStore(() => pool);
  const requestReason = "The artist is ending distribution of this recording";
  assert.equal((await store.request({ artistId: 1, listenerId: 2, songId: 1, reason: requestReason })).error, "not_found");
  const created = await store.request({ artistId: 1, listenerId: 1, songId: 1, reason: requestReason });
  assert.equal(created.request.status, "scheduled");
  const noticeMs = new Date(created.request.due_at) - new Date(created.request.requested_at);
  assert.equal(noticeMs, 30 * 24 * 60 * 60 * 1000);
  assert.equal((await store.request({ artistId: 1, listenerId: 1, songId: 1, reason: requestReason })).error, "already_scheduled");
  assert.equal((await store.cancel({ artistId: 1, listenerId: 2, requestId: created.request.id, reason: "Another account cannot cancel this request" })).error, "not_found");
  assert.equal((await store.cancel({ artistId: 1, listenerId: 1, requestId: created.request.id, reason: "short" })).error, "invalid_reason");
  const cancellationReason = "The artist decided to continue distributing this recording";
  const cancelled = await store.cancel({ artistId: 1, listenerId: 1, requestId: created.request.id, reason: cancellationReason });
  assert.equal(cancelled.request.status, "cancelled");
  assert.equal(cancelled.request.cancellation_reason, cancellationReason);
  assert.equal(cancelled.request.history.at(-1).details.reason, cancellationReason);

  const due = await store.request({ artistId: 1, listenerId: 1, songId: 1, reason: requestReason });
  await pool.query(`update tesohub_music.song_removal_requests
    set requested_at=now()-interval '30 days 1 minute', due_at=now()-interval '1 minute'
    where id=$1`, [due.request.id]);
  assert.equal(await store.runDueBatch(), 1);
  const song = (await pool.query("select status,removal_reason,removed_at,is_featured from tesohub_music.songs where id=1")).rows[0];
  assert.equal(song.status, "removed");
  assert.equal(song.removal_reason, requestReason);
  assert.ok(song.removed_at);
  assert.equal(song.is_featured, false);
  assert.equal((await pool.query("select status from tesohub_music.song_removal_requests where id=$1", [due.request.id])).rows[0].status, "completed");
  assert.equal((await pool.query("select count(*)::int count from tesohub_music.admin_audit_logs where action='scheduled_remove_song' and target_id=1")).rows[0].count, 1);
});
