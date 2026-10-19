import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("Artist verification migration is additive for approved artists and releases", {
  skip: !process.env.TESO_P0C_POSTGRES_PORT,
  timeout: 60000,
}, async (t) => {
  const port = Number(process.env.TESO_P0C_POSTGRES_PORT);
  const config = {
    host: "127.0.0.1",
    port,
    user: "p0c_fixture",
    password: "",
    ssl: false,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  };
  const database = `artist_verification_migration_${process.pid}_${Date.now()}`;
  const control = new pg.Client({ ...config, database: "postgres" });
  await control.connect();
  await control.query(`create database ${database}`);
  const pool = new pg.Pool({ ...config, database, max: 2 });
  t.after(async () => {
    await pool.end();
    await control.query(`drop database ${database}`);
    await control.end();
  });

  await pool.query("create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])");
  await pool.query(fs.readFileSync(new URL("migrations/001_supabase_initial.sql", root), "utf8"));
  await pool.query(`
    insert into tesohub_music.listeners(name,email,role) values ('Legacy Artist','legacy@fixture.invalid','artist');
    insert into tesohub_music.artists(name,status,owner_listener_id) values ('Legacy Stage','active',1);
    insert into tesohub_music.artist_applications(listener_id,artist_id,artist_name,status,genuine_confirmed)
      values (1,1,'Legacy Stage','approved',true);
    update tesohub_music.listeners set artist_id=1, artist_application_id=1 where id=1;
    insert into tesohub_music.platform_settings(id) values (1);
    insert into tesohub_music.releases(artist_id,listener_id,title,status,rights_confirmed)
      values (1,1,'Existing Release','approved',true);
  `);

  await pool.query(fs.readFileSync(new URL("migrations/007_artist_agreements.sql", root), "utf8"));
  await pool.query(fs.readFileSync(new URL("migrations/008_artist_identity_verification.sql", root), "utf8"));

  const listener = (await pool.query("select role,artist_id,artist_application_id from tesohub_music.listeners where id=1")).rows[0];
  const artist = (await pool.query("select status,owner_listener_id from tesohub_music.artists where id=1")).rows[0];
  const application = (await pool.query("select status,verification_status,agreement_acceptance_id from tesohub_music.artist_applications where id=1")).rows[0];
  const release = (await pool.query("select status,rights_confirmed from tesohub_music.releases where id=1")).rows[0];
  const settings = (await pool.query("select artist_agreement_enforcement_mode from tesohub_music.platform_settings where id=1")).rows[0];

  assert.deepEqual(listener, { role: "artist", artist_id: "1", artist_application_id: "1" });
  assert.deepEqual(artist, { status: "active", owner_listener_id: "1" });
  assert.deepEqual(application, { status: "approved", verification_status: "unverified", agreement_acceptance_id: null });
  assert.deepEqual(release, { status: "approved", rights_confirmed: true });
  assert.equal(settings.artist_agreement_enforcement_mode, "off");
});
