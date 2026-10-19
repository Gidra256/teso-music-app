import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("Artist Agreement migration, evidence, versioning and isolation", {
  skip: !process.env.TESO_P0C_POSTGRES_PORT,
  timeout: 60000,
}, async (t) => {
  const config = {
    host: "127.0.0.1",
    port: Number(process.env.TESO_P0C_POSTGRES_PORT),
    user: "p0c_fixture",
    password: "",
    ssl: false,
    statement_timeout: 10000,
  };
  const database = `agreement_gate_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ ...config, database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${database}`);
  const pool = new pg.Pool({ ...config, database, max: 3 });
  t.after(async () => {
    await pool.end();
    await admin.query(`drop database ${database}`);
    await admin.end();
  });

  await pool.query("create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])");
  await pool.query(fs.readFileSync(new URL("migrations/001_supabase_initial.sql", root), "utf8"));
  await pool.query(`insert into tesohub_music.listeners(name,email,password_hash) values ('Legacy Artist','legacy@fixture.invalid','fixture-hash');
    insert into tesohub_music.artists(name) values ('Legacy Artist');
    update tesohub_music.listeners set role='artist', artist_id=1 where id=1;
    insert into tesohub_music.artist_applications(listener_id,artist_id,artist_name,status) values (1,1,'Legacy Artist','approved');
    insert into tesohub_music.platform_settings(id) values (1);`);
  await pool.query(fs.readFileSync(new URL("migrations/007_artist_agreements.sql", root), "utf8"));

  const objects = (await pool.query(`select to_regclass('tesohub_music.artist_agreement_versions') versions,
    to_regclass('tesohub_music.artist_agreement_acceptances') acceptances`)).rows[0];
  assert.ok(objects.versions);assert.ok(objects.acceptances);
  assert.equal((await pool.query("select artist_agreement_enforcement_mode mode from tesohub_music.platform_settings where id=1")).rows[0].mode,"off");
  assert.equal((await pool.query("select count(*)::int count from tesohub_music.listeners")).rows[0].count,1);
  assert.equal((await pool.query("select count(*)::int count from tesohub_music.artist_applications")).rows[0].count,1);
  assert.equal((await pool.query("select agreement_acceptance_id from tesohub_music.artist_applications where id=1")).rows[0].agreement_acceptance_id,null);

  const rls=(await pool.query(`select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='tesohub_music' and relname in ('artist_agreement_versions','artist_agreement_acceptances') order by relname`)).rows;
  assert.equal(rls.length,2);assert.ok(rls.every(row=>row.relrowsecurity));
  const policies=(await pool.query(`select count(*)::int count from pg_policies where schemaname='tesohub_music'
    and tablename in ('artist_agreement_versions','artist_agreement_acceptances') and permissive='RESTRICTIVE'`)).rows[0].count;
  assert.equal(policies,2);
  for (const role of ["PUBLIC","anon","authenticated","service_role"]) {
    if(role!=="PUBLIC" && !(await pool.query("select 1 from pg_roles where rolname=$1",[role])).rowCount) continue;
    const grants=(await pool.query(`select count(*)::int count from information_schema.role_table_grants
      where table_schema='tesohub_music' and table_name in ('artist_agreement_versions','artist_agreement_acceptances') and grantee=$1`,[role])).rows[0].count;
    assert.equal(grants,0,`${role} has direct agreement table access`);
  }

  const content="# Artist Agreement v1\n\nCanonical synthetic agreement used only by local tests.";
  const hash=(await pool.query("select encode(digest(convert_to($1,'UTF8'),'sha256'),'hex') hash",[content])).rows[0].hash;
  await assert.rejects(pool.query(`insert into tesohub_music.artist_agreement_versions(version,title,content_markdown,content_sha256,status,published_at)
    values ('bad-hash','Bad hash', $1, $2, 'published', now())`,[content,"0".repeat(64)]),/SHA-256/);
  const first=(await pool.query(`insert into tesohub_music.artist_agreement_versions(version,title,content_markdown,content_sha256,status,published_at)
    values ('2026-v1','Artist Agreement',$1,$2,'published',now()) returning *`,[content,hash])).rows[0];
  await assert.rejects(pool.query(`insert into tesohub_music.artist_agreement_versions(version,title,content_markdown,content_sha256,status,published_at)
    values ('2026-v2','Artist Agreement v2',$1,$2,'published',now())`,[content,hash]),/unique|duplicate/i);

  const accepted=(await pool.query(`insert into tesohub_music.artist_agreement_acceptances
    (agreement_version_id,listener_id,accepted_version,content_sha256,accepted_at)
    values ($1,1,'forged-version',$2,'2000-01-01') returning *`,[first.id,"0".repeat(64)])).rows[0];
  assert.equal(accepted.accepted_version,"2026-v1");assert.equal(accepted.content_sha256,hash);
  assert.notEqual(new Date(accepted.accepted_at).toISOString(),"2000-01-01T00:00:00.000Z");
  await assert.rejects(pool.query(`insert into tesohub_music.artist_agreement_acceptances
    (agreement_version_id,listener_id,accepted_version,content_sha256) values ($1,1,'x',$2)`,[first.id,hash]),/unique|duplicate/i);
  await assert.rejects(pool.query("update tesohub_music.artist_agreement_acceptances set accepted_version='changed' where id=$1",[accepted.id]),/immutable/);
  await assert.rejects(pool.query("delete from tesohub_music.artist_agreement_acceptances where id=$1",[accepted.id]),/immutable/);
  await assert.rejects(pool.query("update tesohub_music.artist_agreement_versions set content_markdown=content_markdown || ' changed' where id=$1",[first.id]),/immutable|SHA-256/);

  await pool.query("update tesohub_music.artist_agreement_versions set status='retired' where id=$1",[first.id]);
  const contentV2="# Artist Agreement v2\n\nA future synthetic replacement used only by local tests.";
  const hashV2=(await pool.query("select encode(digest(convert_to($1,'UTF8'),'sha256'),'hex') hash",[contentV2])).rows[0].hash;
  await pool.query(`insert into tesohub_music.artist_agreement_versions(version,title,content_markdown,content_sha256,status,published_at)
    values ('2026-v2','Artist Agreement v2',$1,$2,'published',now())`,[contentV2,hashV2]);
  assert.equal((await pool.query("select count(*)::int count from tesohub_music.artist_agreement_versions where status='published'")).rows[0].count,1);
  await assert.rejects(pool.query("update tesohub_music.artist_agreement_versions set status='published' where id=$1",[first.id]),/transition/);
});
