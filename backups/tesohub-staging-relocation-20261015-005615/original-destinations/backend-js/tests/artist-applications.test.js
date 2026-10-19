import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import pg from "pg";
import { test } from "node:test";
import { createSupabasePersistence } from "../supabasePersistence.js";

const root = new URL("../", import.meta.url);
const source = fs.readFileSync(new URL("server.js", root), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

test("Artist Applications actual handlers with isolated PostgreSQL persistence", {skip:!process.env.TESO_P0C_POSTGRES_PORT, timeout:60000}, async t => {
  const port = Number(process.env.TESO_P0C_POSTGRES_PORT);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const config = {host:"127.0.0.1", port, user:"p0c_fixture", password:"", ssl:false, connectionTimeoutMillis:5000, statement_timeout:10000};
  const database = `applications_gate_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({...config, database:"postgres"});
  await admin.connect();
  await admin.query(`create database ${database}`);
  const pool = new pg.Pool({...config, database, max:4});
  t.after(async () => { await pool.end(); await admin.query(`drop database ${database}`); await admin.end(); });
  await pool.query("create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])");
  for (const file of ["001_supabase_initial.sql", "004_support_v1.sql"]) await pool.query(fs.readFileSync(new URL(`migrations/${file}`, root), "utf8"));
  const persistence = createSupabasePersistence({databaseUrl:"postgres://fixture.invalid/unused", supabaseUrl:"https://fixture.invalid", secretKey:"fixture-only", buckets:{audio:"music-audio",artwork:"artwork",avatars:"avatars"}, storageUrlFor:(b,p)=>`/api/storage/${b}/${p}`, poolFactory:()=>pool});
  const tables = (await pool.query("select tablename from pg_tables where schemaname='tesohub_music'")).rows.map(r=>`tesohub_music.${r.tablename}`);
  const routes = new Map();
  const clean = v=>String(v||"").trim();
  const ctx = vm.createContext({structuredClone, USE_SUPABASE_PERSISTENCE:true, supabasePersistence:persistence,
    ADMIN_USERNAME:"fixture-admin", ADMIN_ROLES:{SUPER_ADMIN:"super_admin"},
    app:Object.fromEntries(["get","post"].map(method=>[method,(path,...handlers)=>routes.set(`${method} ${path}`, handlers.at(-1))])),
    requireAdminPermission:()=>()=>{}, upload:{single:()=>()=>{}},
    normalizeDb:db=>{db.nextIds={}; for(const [key,rows] of [["artist",db.artists],["artistApplication",db.artistApplications],["adminAuditLog",db.adminAuditLogs]]) db.nextIds[key]=Math.max(0,...rows.map(r=>Number(r.id)))+1; return db;},
    cleanText:clean, normalizePhone:clean, normalizeEmail:v=>clean(v).toLowerCase(), boolValue:v=>v===true||v==="true",
    genrePayload:req=>({genre:req.body.genre,genre_note:""}), validateUploadSettings:()=>null,
    uploadUrlFor:async()=>"/api/storage/avatars/fixture/photo.png", platformSettingsFor:()=>({artist_applications_enabled:true}),
    absoluteUrl:(req,v)=>v||"", serializeArtist:(db,req,row)=>({id:row.id,name:row.name}),
    serializeListener:(db,row)=>({id:row.id,role:row.role,artist_id:row.artist_id}),
    findListenerByToken:(db,req)=>db.listeners.find(r=>r.id===(req.listenerId||1)),
  });
  for (const name of ["nowIso","maxNextId","latestApplicationForListener","publicListener","serializeArtistApplication","applicationPayload","validateArtistApplication","createArtistFromApplication","appendAuditLog","requireListener","requireArtist"]) vm.runInContext(extract(name),ctx);
  vm.runInContext(source.slice(source.indexOf("const writeBaselines ="),source.indexOf("function nowIso()")),ctx);
  vm.runInContext(source.slice(source.indexOf('app.get("/api/artist-applications/me/"'),source.indexOf('app.get("/api/artist-studio/dashboard/"')),ctx);
  vm.runInContext(source.slice(source.indexOf('app.get("/admin-api/artist-applications"'),source.indexOf('app.get("/admin-api/releases"')),ctx);
  async function call(method,path,{id=1,body={},query={},listenerId=1}={}) {
    let status=200, data;
    const res={status:code=>{status=code;return res;},set:()=>res,json:value=>{data=value;return res;}};
    const req={params:{id:String(id)},body,query,listenerId,file:{fieldname:"photo_file"},adminUser:{username:"fixture-admin",role:"content_admin"}};
    try {await routes.get(`${method} ${path}`)(req,res);} catch(error) {if(error.code!=="STALE_WRITE") throw error;status=409;}
    return {status,data};
  }
  const rows = async table=>(await pool.query(`select * from tesohub_music.${table} order by 1`)).rows;
  async function reset() {
    await pool.query(`truncate ${tables.join(",")} restart identity cascade;
      insert into tesohub_music.listeners(name,email,password_hash) values ('Applicant','applicant@fixture.invalid','fixture-password-hash'),('Other','other@fixture.invalid','fixture-other-hash');
      insert into tesohub_music.artists(name) values ('Unrelated artist');
      insert into tesohub_music.songs(artist_id,title) values (1,'Unrelated song');
      insert into tesohub_music.auth_tokens(id,listener_id,token_hash) values ('fixture-session',1,'fixture-session-hash');
      insert into tesohub_music.platform_settings(id) values (1);`);
  }
  async function submit() {
    const result=await call("post","/api/artist-applications/",{body:{artist_name:"Fixture Stage",contact_name:"Fixture Contact",bio:"A sufficiently long synthetic biography.",country:"Uganda",region:"Teso",genre:"Gospel",phone:"0700000000",email:"contact@fixture.invalid",genuine_confirmed:true}});
    assert.equal(result.status,201);return result.data.application.id;
  }
  const approve=id=>call("post","/admin-api/artist-applications/:id/approve",{id});
  async function check(name,run){await t.test(name,async()=>{await reset();await run();});}

  await check("submission is persisted, visible in All/Pending/search/detail and listener status",async()=>{
    const id=await submit();
    for(const query of [{},{status:"pending"},{search:"stage"},{search:"applicant@fixture.invalid"},{search:"Fixture Contact",status:"pending"}]) {
      const result=await call("get","/admin-api/artist-applications",{query});assert.equal(result.status,200);assert.equal(result.data.length,1);assert.equal(result.data[0].id,id);
    }
    assert.equal((await call("get","/admin-api/artist-applications",{query:{status:"under_review"}})).status,400);
    assert.equal((await call("get","/admin-api/artist-applications",{query:{status:"approved"}})).data.length,0);
    const detail=await call("get","/admin-api/artist-applications/:id",{id});assert.equal(detail.data.history.length,0);
    assert.ok(!JSON.stringify(detail.data).includes("fixture-password-hash"));
    assert.equal((await call("get","/api/artist-applications/me/")).data.application.status,"pending");
  });
  await check("approve once, retry idempotently, preserve account/session and grant Studio access",async()=>{
    const id=await submit();const first=await approve(id),second=await approve(id);
    assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(first.data.artist.id,second.data.artist.id);
    assert.equal((await rows("artists")).length,2);assert.equal((await rows("admin_audit_logs")).length,1);
    const listener=(await rows("listeners"))[0];assert.equal(listener.password_hash,"fixture-password-hash");assert.equal(listener.email,"applicant@fixture.invalid");assert.equal(listener.role,"artist");
    assert.equal((await rows("auth_tokens"))[0].token_hash,"fixture-session-hash");
    assert.ok(ctx.requireArtist(await ctx.loadDb(),{listenerId:1},{status:()=>{throw Error("Studio denied");}}));
    const detail=(await call("get","/admin-api/artist-applications/:id",{id})).data;assert.equal(detail.history[0].admin_role,"content_admin");assert.equal(detail.reviewed_by,"fixture-admin");
    assert.equal((await call("post","/admin-api/artist-applications/:id/reject",{id,body:{reason:"Late rejection"}})).status,409);
  });
  await check("rejection requires reason, preserves listener and never creates an artist",async()=>{
    const id=await submit();
    assert.equal((await call("post","/admin-api/artist-applications/:id/reject",{id})).status,400);
    for(let i=0;i<2;i++) assert.equal((await call("post","/admin-api/artist-applications/:id/reject",{id,body:{reason:"Provide clearer details"}})).status,200);
    assert.equal((await rows("artists")).length,1);assert.equal((await rows("admin_audit_logs")).length,1);
    assert.equal((await rows("listeners"))[0].role,"listener");assert.equal((await rows("listeners"))[0].password_hash,"fixture-password-hash");
    assert.equal((await rows("artist_applications"))[0].rejection_reason,"Provide clearer details");
  });
  await check("concurrent approval retries create one artist and one audit transaction",async()=>{
    const id=await submit(), original=ctx.loadDb;let count=0,release;
    const barrier=new Promise(r=>{release=r;});
    ctx.loadDb=async()=>{const db=await original();if(++count<=2){if(count===2)release();await barrier;}return db;};
    try {const results=await Promise.all([approve(id),approve(id)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results[0].data.artist.id,results[1].data.artist.id);}
    finally {ctx.loadDb=original;}
    assert.equal((await rows("artists")).length,2);assert.equal((await rows("admin_audit_logs")).length,1);
  });
  await check("review preserves likes, follows, playlists, account edits and unrelated catalog",async()=>{
    const id=await submit(), original=ctx.saveDb;
    ctx.saveDb=async db=>{
      await persistence.likeSong({listenerId:1,songId:1});await persistence.followArtist({listenerId:1,artistId:1});
      const list=await persistence.createPlaylist({listenerId:1,name:"Keep my playlist"});await persistence.addSongToPlaylist({listenerId:1,playlistId:list.id,songId:1});
      await pool.query("update tesohub_music.listeners set name='Changed during review' where id=1");await original(db);
    };
    try {assert.equal((await approve(id)).status,200);} finally {ctx.saveDb=original;}
    for(const table of ["song_likes","artist_follows","playlists","playlist_songs"]) assert.equal((await rows(table)).length,1);
    assert.equal((await rows("listeners"))[0].name,"Changed during review");assert.equal((await rows("songs"))[0].title,"Unrelated song");assert.equal((await rows("artists"))[0].name,"Unrelated artist");
  });
  await check("request changes, resubmission and outdated review protection",async()=>{
    const old=await submit();
    assert.equal((await call("post","/admin-api/artist-applications/:id/request-changes",{id:old,body:{reason:"Clarify biography"}})).status,200);
    const latest=await submit();assert.notEqual(old,latest);
    assert.equal((await approve(old)).status,409);
    assert.equal((await call("post","/admin-api/artist-applications/:id/reject",{id:old,body:{reason:"Outdated"}})).status,409);
    assert.equal((await approve(latest)).status,200);
  });
  await check("competing approval and rejection commit one decision without partial artist/audit data",async()=>{
    const id=await submit(),original=ctx.loadDb;let count=0,release;
    const barrier=new Promise(r=>{release=r;});
    ctx.loadDb=async()=>{const db=await original();if(++count<=2){if(count===2)release();await barrier;}return db;};
    let results;
    try {results=await Promise.all([approve(id),call("post","/admin-api/artist-applications/:id/reject",{id,body:{reason:"Review declined"}})]);}
    finally {ctx.loadDb=original;}
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const approved=(await rows("artist_applications"))[0].status==="approved";
    assert.equal((await rows("artists")).length,approved?2:1);assert.equal((await rows("admin_audit_logs")).length,1);
    assert.equal((await rows("listeners"))[0].role,approved?"artist":"listener");
  });
  await check("attention-first sorting retains approved/rejected and missing-account rows without an inner join",async()=>{
    await submit();
    await pool.query(`insert into tesohub_music.artist_applications(artist_name,status,created_at) values
      ('Approved fixture','approved','2026-10-09'),('Rejected fixture','rejected','2026-10-10'),('Needs changes','changes_requested','2026-10-11')`);
    const all=(await call("get","/admin-api/artist-applications")).data;
    assert.equal(all.length,4);assert.ok(all.slice(0,2).every(row=>["pending","changes_requested"].includes(row.status)));
    assert.equal(all.find(row=>row.artist_name==="Needs changes").applicant,null);
    assert.equal((await call("get","/admin-api/artist-applications",{query:{status:"approved"}})).data.length,1);
    assert.equal((await call("get","/admin-api/artist-applications",{query:{status:"rejected"}})).data.length,1);
  });
  await check("approval refuses a foreign existing artist linkage",async()=>{
    const id=await submit();await pool.query("update tesohub_music.artist_applications set artist_id=1 where id=$1",[id]);
    assert.equal((await approve(id)).status,409);assert.equal((await rows("artists")).length,1);
    assert.equal((await rows("admin_audit_logs")).length,0);assert.equal((await rows("listeners"))[0].role,"artist_pending");
  });
});
