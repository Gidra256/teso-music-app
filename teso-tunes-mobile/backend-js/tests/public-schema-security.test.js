import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import pg from "pg";
import { createSupabasePersistence } from "../supabasePersistence.js";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const proposal = read("../security-review/public-client-containment.proposed.sql");
const metadata = read("../security-review/public-schema-metadata.readonly.sql");
const tables = ["profiles", "likes", "follows", "song_plays"];

test("containment is standalone and transactional, without row changes or function-body rewrites", () => {
  assert.match(proposal,/begin;/);assert.match(proposal,/commit;/);
  assert.doesNotMatch(proposal,/\b(?:insert into|delete from|update public|drop table|alter function)\b/i);
  assert.doesNotMatch(proposal,/tesohub_music\./);
});

test("public schema emergency containment with synthetic local records only", {skip:!process.env.TESO_P0C_POSTGRES_PORT,timeout:60000}, async t => {
  // Never read a production connection string, key or token.
  const port=Number(process.env.TESO_P0C_POSTGRES_PORT);assert.ok(port>=1024&&port<=65535);
  const config={host:"127.0.0.1",port,user:"p0c_fixture",password:"",ssl:false,statement_timeout:10000};
  const database=`public_audit_${process.pid}_${Date.now()}`;
  const roles={anon:`pub_anon_${process.pid}`,authenticated:`pub_auth_${process.pid}`,backend:`pub_owner_${process.pid}`,probe:`pub_probe_${process.pid}`,service:`pub_service_${process.pid}`,bridge:`pub_bridge_${process.pid}`};
  const control=new pg.Client({...config,database:"postgres"});await control.connect();
  await control.query(`create database ${database}`);
  const admin=new pg.Pool({...config,database});let backend;
  t.after(async()=>{if(backend)await backend.end();await admin.end();await control.query(`drop database ${database}`);for(const role of Object.values(roles))await control.query(`drop role ${role}`);await control.end();});
  for(const role of Object.values(roles))await control.query(`create role ${role} nologin nosuperuser nobypassrls`);
  await control.query(`grant create on database ${database} to ${roles.backend}`);
  await admin.query(`create extension if not exists pgcrypto;
    create schema storage authorization ${roles.backend};
    create schema tesohub_music authorization ${roles.backend};
    grant usage,create on schema public to ${roles.backend};
    grant usage on schema public to ${roles.anon},${roles.authenticated},${roles.probe}`);
  backend=new pg.Pool({...config,database,options:`-c role=${roles.backend}`});
  assert.equal((await backend.query("select current_user")).rows[0].current_user,roles.backend);
  await backend.query("create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[])");
  for(const file of ["001_supabase_initial.sql","004_support_v1.sql","005_support_identity_defaults.sql"])
    await backend.query(read(`../migrations/${file}`));
  // Illustrative columns ONLY: the live public table definitions are unknown.
  await backend.query(`create table public.profiles(id text primary key,email text,display_name text,username text);
    create table public.likes(id bigint generated always as identity primary key,user_id text,song_id bigint);
    create table public.follows(id bigint generated always as identity primary key,user_id text,artist_id bigint);
    create table public.song_plays(id bigint generated always as identity primary key,user_id text,song_id bigint,plays bigint);
    insert into public.profiles(id,email,display_name) values('A','a@fixture.invalid','A'),('B','b@fixture.invalid','B');
    insert into public.likes(user_id,song_id) values('B',1);
    insert into public.follows(user_id,artist_id) values('B',1);
    insert into public.song_plays(user_id,song_id,plays) values('B',1,1);
    grant all on public.profiles,public.likes,public.follows,public.song_plays to public,${roles.anon},${roles.authenticated};
    grant select(email),update(display_name) on public.profiles to public,${roles.anon},${roles.authenticated};
    grant all on all sequences in schema public to public,${roles.anon},${roles.authenticated}`);
  // Verified function bodies; songs policies below are illustrative, NOT live policies.
  await backend.query(`create table public.songs(id uuid primary key,plays integer not null default 0);
    insert into public.songs values('00000000-0000-0000-0000-000000000001',0);
    alter table public.songs enable row level security;
    grant select,update on public.songs to ${roles.anon},${roles.authenticated};
    create policy fixture_song_read on public.songs for select to public using(true);
    create policy fixture_song_write on public.songs for update to ${roles.authenticated} using(true) with check(true);
    create function public.handle_new_user() returns trigger language plpgsql security invoker as $$
    begin
      insert into profiles (id, username)
      values (new.id, new.email);
      return new;
    end;
    $$;
    create function public.increment_song_plays(song_uuid uuid) returns void language plpgsql security invoker as $$
    begin
      update songs
      set plays = plays + 1
      where id = song_uuid;
    end;
    $$;
    grant execute on function public.handle_new_user(),public.increment_song_plays(uuid) to ${roles.anon},${roles.authenticated},${roles.service}`);
  const functionSnapshot=async()=> (await admin.query("select proname,prosrc,proowner,prosecdef,proconfig from pg_proc where oid in ('public.handle_new_user()'::regprocedure,'public.increment_song_plays(uuid)'::regprocedure) order by proname")).rows;
  const songSnapshot=async()=>({
    schema:(await admin.query("select relacl::text,relrowsecurity,relforcerowsecurity from pg_class where oid='public.songs'::regclass")).rows,
    policies:(await admin.query("select policyname,permissive,roles::text[],cmd,qual,with_check from pg_policies where schemaname='public' and tablename='songs' order by policyname")).rows,
    data:(await backend.query("select * from public.songs order by id")).rows
  });
  const originalFunctions=await functionSnapshot(),originalSongs=await songSnapshot();
  async function asClient(role,fn,uid="A"){
    const c=await admin.connect();
    try{await c.query("begin");await c.query(`set local role ${role}`);await c.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return await fn(c);}
    finally{await c.query("rollback");c.release();}
  }
  await t.test("reproduces anonymous profile exposure, cross-user writes and forged engagement before containment",async()=>{
    await asClient(roles.anon,async c=>{
      assert.equal((await c.query("select email from public.profiles")).rowCount,2);
      assert.equal((await c.query("update public.profiles set display_name='forged' where id='B'")).rowCount,1);
      assert.equal((await c.query("insert into public.likes(user_id,song_id) values('B',2)")).rowCount,1);
      assert.equal((await c.query("insert into public.follows(user_id,artist_id) values('B',2)")).rowCount,1);
      assert.equal((await c.query("update public.song_plays set plays=1000000")).rowCount,1);
    });
  });
  const applied=proposal.replace(/\banon\b/g,roles.anon).replace(/\bauthenticated\b/g,roles.authenticated);
  await t.test("verified invoker RPC obeys songs RLS before containment, but retains client EXECUTE",async()=>{
    for(const role of [roles.anon,roles.authenticated])await asClient(role,async c=>{
      assert.equal((await c.query("select has_function_privilege(current_user,'public.increment_song_plays(uuid)','EXECUTE') allowed")).rows[0].allowed,true);
      await c.query("select public.increment_song_plays('00000000-0000-0000-0000-000000000001')");
      assert.equal((await c.query("select plays from public.songs")).rows[0].plays,role===roles.authenticated?1:0);
    });
  });
  await t.test("new trigger dependency aborts the proposed patch without altering table security",async()=>{
    const c=await backend.connect();
    try{
      await c.query("create table public.fixture_signup(id text,email text); create trigger fixture_signup after insert on public.fixture_signup for each row execute function public.handle_new_user()");
      await assert.rejects(()=>c.query(applied),error=>error.code==="P0001"&&/trigger dependency/.test(error.message));
      await c.query("rollback");
      assert.equal((await c.query("select relrowsecurity from pg_class where oid='public.profiles'::regclass")).rows[0].relrowsecurity,false);
    }finally{await c.query("rollback");await c.query("drop table if exists public.fixture_signup");c.release();}
  });
  await t.test("inherited function EXECUTE aborts and rolls back earlier table revocations",async()=>{
    await control.query(`grant ${roles.bridge} to ${roles.anon}`);
    await backend.query(`grant execute on function public.increment_song_plays(uuid) to ${roles.bridge}`);
    const c=await backend.connect();
    try{
      await assert.rejects(()=>c.query(applied),error=>error.code==="P0001"&&/inherited client EXECUTE/.test(error.message));
      await c.query("rollback");
      assert.equal((await c.query("select relrowsecurity from pg_class where oid='public.profiles'::regclass")).rows[0].relrowsecurity,false);
      assert.equal((await c.query("select has_table_privilege($1,'public.profiles','SELECT') allowed",[roles.anon])).rows[0].allowed,true);
    }finally{await c.query("rollback");c.release();await backend.query(`revoke execute on function public.increment_song_plays(uuid) from ${roles.bridge}`);await control.query(`revoke ${roles.bridge} from ${roles.anon}`);}
  });
  await t.test("a failed containment transaction leaves all original security metadata intact",async()=>{
    const c=await backend.connect();
    try{await assert.rejects(()=>c.query(applied.replace("commit;","select fixture_missing_security_step(); commit;")),{code:"42883"});}
    finally{await c.query("rollback");c.release();}
    assert.equal((await admin.query("select count(*)::int n from pg_class where oid=any($1::regclass[]) and relrowsecurity",[tables.map(x=>`public.${x}`)])).rows[0].n,0);
    assert.equal((await admin.query("select has_table_privilege($1,'public.profiles','SELECT') allowed",[roles.anon])).rows[0].allowed,true);
  });
  const before=(await backend.query("select jsonb_agg(p) rows from public.profiles p")).rows;
  await backend.query(applied);
  await t.test("both exact RPC signatures deny client EXECUTE; owner and explicit service grant remain",async()=>{
    for(const role of [roles.anon,roles.authenticated,roles.probe])await asClient(role,async c=>{
      for(const signature of ["public.handle_new_user()","public.increment_song_plays(uuid)"]){
        assert.equal((await c.query("select has_function_privilege(current_user,$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
      }
      for(const sql of ["select public.handle_new_user()","select public.increment_song_plays('00000000-0000-0000-0000-000000000001')"]){
        await c.query("savepoint denied_rpc");await assert.rejects(()=>c.query(sql),{code:"42501"});await c.query("rollback to savepoint denied_rpc");
      }
    });
    for(const role of [roles.backend,roles.service])for(const signature of ["public.handle_new_user()","public.increment_song_plays(uuid)"])
      assert.equal((await admin.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed,true);
    assert.deepEqual(await functionSnapshot(),originalFunctions);
  });
  await t.test("public.songs data, policies, RLS flags and grants remain byte-for-byte equivalent",async()=>{
    assert.deepEqual(await songSnapshot(),originalSongs);
  });
  await t.test("duplicate patch execution fails and rolls back without reopening any access",async()=>{
    const c=await backend.connect();
    try{await assert.rejects(()=>c.query(applied),{code:"42710"});}
    finally{await c.query("rollback");c.release();}
    assert.equal((await admin.query("select has_table_privilege($1,'public.profiles','SELECT') allowed,has_function_privilege($1,'public.increment_song_plays(uuid)','EXECUTE') rpc",[roles.anon])).rows[0].allowed,false);
    assert.equal((await admin.query("select has_function_privilege($1,'public.increment_song_plays(uuid)','EXECUTE') allowed",[roles.anon])).rows[0].allowed,false);
  });
  await t.test("containment preserves records, enables RLS and removes table/column/sequence privileges",async()=>{
    assert.deepEqual((await backend.query("select jsonb_agg(p) rows from public.profiles p")).rows,before);
    for(const role of [roles.anon,roles.authenticated,roles.probe])for(const table of tables){
      const row=(await admin.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') t,has_any_column_privilege($1,$2,'SELECT,INSERT,UPDATE,REFERENCES') c",[role,`public.${table}`])).rows[0];
      assert.deepEqual(row,{t:false,c:false});
    }
    for(const role of [roles.anon,roles.authenticated,roles.probe])for(const table of tables.slice(1))
      assert.equal((await admin.query("select has_sequence_privilege($1,$2,'USAGE,SELECT,UPDATE') allowed",[role,`public.${table}_id_seq`])).rows[0].allowed,false);
    assert.equal((await admin.query("select count(*)::int n from pg_class where oid=any($1::regclass[]) and relrowsecurity",[tables.map(x=>`public.${x}`)])).rows[0].n,4);
  });
  for(const [name,role,uid] of [["anon",roles.anon,"A"],["authenticated A",roles.authenticated,"A"],["authenticated B",roles.authenticated,"B"]]){
    await t.test(`${name} cannot read private data, edit/delete profiles or forge likes/follows/plays`,async()=>{
      await asClient(role,async c=>{
        for(const sql of ["select email from public.profiles","update public.profiles set display_name='forged'","delete from public.profiles",
          "insert into public.likes(user_id,song_id) values('B',2)","delete from public.likes","insert into public.follows(user_id,artist_id) values('A',2)","delete from public.follows",
          "insert into public.song_plays(user_id,song_id,plays) values('B',1,999)","update public.song_plays set plays=999","delete from public.song_plays"]){
          await c.query("savepoint attempt");await assert.rejects(()=>c.query(sql),{code:"42501"});await c.query("rollback to savepoint attempt");
        }
      },uid);
    });
  }
  await t.test("RLS still blocks profile rows if a DML grant and permissive policy are accidentally restored",async()=>{
    const c=await admin.connect();
    try{await c.query("begin");await c.query(`grant select,insert,update,delete on public.profiles to ${roles.authenticated}`);
      await c.query("create policy accidental_allow on public.profiles for all to public using(true) with check(true)");
      await c.query(`set local role ${roles.authenticated}`);
      assert.equal((await c.query("select * from public.profiles")).rowCount,0);
      assert.equal((await c.query("update public.profiles set display_name='forged'")).rowCount,0);
      assert.equal((await c.query("delete from public.profiles")).rowCount,0);
      await assert.rejects(()=>c.query("insert into public.profiles(id,email,display_name) values('C','c@fixture.invalid','C')"),{code:"42501"});
    }finally{await c.query("rollback");c.release();}
  });
  await t.test("real authoritative persistence login/profile, likes, follows and play counts still work through SQL owner",async()=>{
    const p=createSupabasePersistence({databaseUrl:"fixture-only",supabaseUrl:"https://fixture.invalid",secretKey:"fixture-only",buckets:{audio:"music-audio",artwork:"artwork",avatars:"avatars"},storageUrlFor:(b,x)=>`/api/storage/${b}/${x}`,poolFactory:()=>backend,storageFetch:async()=>{throw Error("Network forbidden");}});
    const profile=await p.createListenerAccount({name:"Synthetic",email:"listener@fixture.invalid",passwordHash:"fixture-hash",sessionId:"fixture-session",tokenHash:"fixture-token-hash"});
    assert.equal((await p.listenerByIdentifier({email:"listener@fixture.invalid"})).id,profile.id);
    assert.equal((await p.listenerByTokenHash("fixture-token-hash")).id,profile.id);
    await backend.query("insert into tesohub_music.artists(name) values('Fixture'); insert into tesohub_music.songs(artist_id,title,status) values(1,'Fixture','published')");
    await p.likeSong({songId:1,listenerId:profile.id});await p.followArtist({artistId:1,listenerId:profile.id});
    const saved=await p.listenerProfile(profile.id);assert.equal(saved.liked_song_ids.length,1);assert.equal(saved.followed_artist_ids.length,1);
    await p.unlikeSong({songId:1,listenerId:profile.id});await p.unfollowArtist({artistId:1,listenerId:profile.id});
    const cleared=await p.listenerProfile(profile.id);assert.equal(cleared.liked_song_ids.length,0);assert.equal(cleared.followed_artist_ids.length,0);
    assert.equal((await p.recordSongPlay(1)).play_count,1);
    const playlist=await p.createPlaylist({listenerId:profile.id,name:"Fixture playlist"});
    await p.addSongToPlaylist({listenerId:profile.id,playlistId:playlist.id,songId:1});
    assert.equal((await p.getPlaylist(profile.id,playlist.id)).songs.length,1);
    await p.removeSongFromPlaylist({listenerId:profile.id,playlistId:playlist.id,songId:1});
    await p.updatePlaylist({listenerId:profile.id,playlistId:playlist.id,name:"Renamed fixture"});
    assert.equal((await p.getPlaylist(profile.id,playlist.id)).name,"Renamed fixture");
    await p.deletePlaylist(profile.id,playlist.id);
    const original=await p.loadDb(),changed=structuredClone(original);
    changed.listeners.find(x=>x.id===profile.id).name="Updated listener";
    await p.saveChanges(original,changed);
    assert.equal((await p.listenerProfile(profile.id)).name,"Updated listener");
    await backend.query("update public.profiles set display_name='Owner maintenance' where id='A'");
    assert.equal((await backend.query("select display_name from public.profiles where id='A'")).rows[0].display_name,"Owner maintenance");
  });
  await t.test("known limitation: owner SECURITY DEFINER RPC can bypass table isolation and needs separate review",async()=>{
    await backend.query("create function public.fixture_rpc() returns bigint language sql security definer as $$ select count(*) from public.profiles $$");
    await asClient(roles.anon,async c=>{assert.equal(Number((await c.query("select public.fixture_rpc() n")).rows[0].n),2);});
  });
  await t.test("read-only inventory queries execute without invoking functions or modifying rows",async()=>{
    await admin.query(metadata);
    assert.equal((await backend.query("select count(*)::int n from public.profiles")).rows[0].n,2);
  });
});
