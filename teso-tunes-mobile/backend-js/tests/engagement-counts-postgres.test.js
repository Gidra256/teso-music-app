import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import pg from "pg";
import { createSupabasePersistence } from "../supabasePersistence.js";

test("engagement responses match authoritative PostgreSQL counts", {skip:!process.env.TESO_P0C_POSTGRES_PORT, timeout:60000}, async t => {
  // Loopback synthetic database only; never consume production connection settings.
  const port = Number(process.env.TESO_P0C_POSTGRES_PORT);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const config = {host:"127.0.0.1", port, user:"p0c_fixture", password:"", ssl:false, statement_timeout:10000};
  const database = `engagement_counts_${process.pid}_${Date.now()}`;
  const control = new pg.Client({...config, database:"postgres"});
  await control.connect();
  await control.query(`create database ${database}`);
  const pool = new pg.Pool({...config, database, max:4});
  t.after(async () => { await pool.end(); await control.query(`drop database ${database}`); await control.end(); });
  await pool.query("create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[])");
  for (const name of ["001_supabase_initial.sql", "004_support_v1.sql", "005_support_identity_defaults.sql"])
    await pool.query(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  await pool.query(`insert into tesohub_music.listeners(name,email) values ('A','a@fixture.invalid'),('B','b@fixture.invalid');
    insert into tesohub_music.artists(name,is_featured) values ('Fixture Artist',true);
    insert into tesohub_music.songs(artist_id,title,audio_path,play_count,is_featured,release_date)
    values (1,'Fixture Song','fixture/song.mp3',7,true,(now() at time zone 'UTC')::date);`);
  let failCount = false;
  const query = async (client, sql, values) => {
    if (failCount && /^select count\(\*\)::int as (follower_count|like_count)/.test(sql.trim()))
      throw new Error("Synthetic count failure");
    return client.query(sql, values);
  };
  const adapter = {
    query:(sql, values) => query(pool, sql, values),
    connect:async () => {
      const client = await pool.connect();
      return {query:(sql, values) => query(client, sql, values), release:() => client.release()};
    },
  };
  const p = createSupabasePersistence({
    databaseUrl:"postgres://fixture.invalid/unused", supabaseUrl:"https://fixture.invalid", secretKey:"fixture-only",
    poolFactory:() => adapter, buckets:{audio:"music-audio", artwork:"artwork", avatars:"avatars"},
    storageUrlFor:(bucket, path) => `/api/storage/${bucket}/${path}`,
    storageFetch:async () => { throw Error("Network forbidden in engagement fixture"); },
  });
  for (const spec of [
    {table:"artist_follows", column:"artist_id", key:"artistId", field:"follower_count", state:"followed", add:"followArtist", remove:"unfollowArtist", detail:"getPublicArtist", list:"listPublicArtists"},
    {table:"song_likes", column:"song_id", key:"songId", field:"like_count", state:"liked", add:"likeSong", remove:"unlikeSong", detail:"getPublicSong", list:"listPublicSongs"},
  ]) {
    const args = (user, device = `fixture-${user}`) => ({[spec.key]:1, listenerId:user, deviceId:device});
    const reset = () => pool.query(`delete from tesohub_music.${spec.table}`);
    const count = async () => (await pool.query(`select count(*)::int n from tesohub_music.${spec.table} where ${spec.column}=1`)).rows[0].n;
    async function verify(result, expected, state) {
      assert.equal(await count(), expected, "stored count");
      assert.equal(result[spec.field], expected, "mutation response count must include its own write");
      assert.equal(result[spec.state], state);
      assert.equal((await p[spec.detail](1))[spec.field], expected, "fresh detail/reload");
      assert.equal((await p[spec.list]()).find(item => item.id===1)[spec.field], expected, "catalog list");
      for (const discovery of ["more", "popular", "featured", "new"])
        assert.equal((await p[spec.list]({discovery, limit:10})).find(item => item.id===1)[spec.field], expected, `discovery ${discovery}`);
    }
    await t.test(`${spec.add}: zero, N, two users, duplicate, removal and reload`, async () => {
      await reset();
      await verify(await p[spec.add](args(1)), 1, true);
      await verify(await p[spec.add](args(1)), 1, true);
      await verify(await p[spec.add](args(2)), 2, true);
      await verify(await p[spec.remove](args(2)), 1, false);
      await verify(await p[spec.remove](args(2)), 1, false);
      await verify(await p[spec.remove](args(1)), 0, false);
    });
    await t.test(`${spec.add}: existing device ownership promotion does not add a row`, async () => {
      await reset();
      await verify(await p[spec.add](args(null, "fixture-guest")), 1, true);
      await verify(await p[spec.add](args(1, "fixture-guest")), 1, true);
      assert.equal(Number((await pool.query(`select listener_id from tesohub_music.${spec.table}`)).rows[0].listener_id), 1);
    });
    await t.test(`${spec.remove}: counts actual rows removed, not a guessed minus one`, async () => {
      await reset();
      await p[spec.add](args(1));
      await p[spec.add](args(null, "fixture-other-device"));
      await verify(await p[spec.remove](args(1, "fixture-other-device")), 0, false);
    });
    await t.test(`${spec.add}: simultaneous duplicate requests return one committed engagement`, async () => {
      await reset();
      const results = await Promise.all([p[spec.add](args(1)), p[spec.add](args(1))]);
      for (const result of results) await verify(result, 1, true);
    });
    await t.test(`${spec.add}: count failure rolls back mutation and releases connection`, async () => {
      await reset();
      failCount = true;
      try { await assert.rejects(() => p[spec.add](args(1)), /Synthetic count failure/); }
      finally { failCount = false; }
      assert.equal(await count(), 0);
      await verify(await p[spec.add](args(1)), 1, true);
      failCount = true;
      try { await assert.rejects(() => p[spec.remove](args(1)), /Synthetic count failure/); }
      finally { failCount = false; }
      assert.equal(await count(), 1, "Failed count also rolls back removal");
    });
    await t.test(`${spec.add}: missing target does not write or invent a count`, async () => {
      assert.deepEqual(await p[spec.add]({...args(1), [spec.key]:9999}), {notFound:true});
    });
  }
});
