import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import pg from "pg";
import {test} from "node:test";
import {execFileSync} from "node:child_process";
import {createSupabasePersistence} from "../supabasePersistence.js";
import {audioResponseUrl} from "../audioAccess.js";

const root = new URL("../", import.meta.url);
const source = fs.readFileSync(new URL("server.js", root), "utf8").replace(/\r\n/g,"\n");
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

test("Release Review actual handlers and isolated PostgreSQL transactions", {skip:!process.env.TESO_P0C_POSTGRES_PORT,timeout:60000}, async t => {
  const port = Number(process.env.TESO_P0C_POSTGRES_PORT);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const config = {host:"127.0.0.1",port,user:"p0c_fixture",password:"",ssl:false,connectionTimeoutMillis:5000,statement_timeout:10000};
  const database = `release_review_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({...config,database:"postgres"}); await admin.connect(); await admin.query(`create database ${database}`);
  const pool = new pg.Pool({...config,database,max:5});
  t.after(async()=>{await pool.end();await admin.query(`drop database ${database}`);await admin.end();});
  await pool.query("create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[])");
  for (const file of ["001_supabase_initial.sql","004_support_v1.sql"]) await pool.query(fs.readFileSync(new URL(`migrations/${file}`,root),"utf8"));
  const p = createSupabasePersistence({databaseUrl:"postgres://fixture.invalid/unused",supabaseUrl:"https://fixture.invalid",secretKey:"fixture-only",buckets:{audio:"music-audio",artwork:"artwork",avatars:"avatars"},storageUrlFor:(b,path)=>`/api/storage/${b}/${path}`,poolFactory:()=>pool});
  const tables=(await pool.query("select tablename from pg_tables where schemaname='tesohub_music'")).rows.map(r=>`tesohub_music.${r.tablename}`);
  const routes=new Map(), clean=v=>String(v||"").trim();
  const ctx=vm.createContext({structuredClone,USE_SUPABASE_PERSISTENCE:true,supabasePersistence:p,ADMIN_USERNAME:"fixture-admin",ADMIN_ROLES:{SUPER_ADMIN:"super_admin"},
    app:Object.fromEntries(["get","post","put"].map(method=>[method,(path,...handlers)=>routes.set(`${method} ${path}`,handlers.at(-1))])),
    requireAdminPermission:()=>()=>{},upload:{fields:()=>()=>{}},
    normalizeDb:db=>{db.nextIds={};for(const [key,rows] of [["release",db.releases],["song",db.songs],["adminAuditLog",db.adminAuditLogs]]) db.nextIds[key]=Math.max(0,...rows.map(r=>Number(r.id)))+1;return db;},
    cleanText:clean,boolValue:v=>v===true,genrePayload:req=>({genre:req.body.genre,genre_note:""}),validateUploadSettings:()=>null,
    featureFlagsFor:()=>({artist_studio_enabled:true}),platformSettingsFor:()=>({music_uploads_enabled:true}),
    uploadUrlFor:async file=>file?`/api/storage/${file.fieldname==="audio_upload"?"music-audio":"artwork"}/fixture/${file.name || file.fieldname}`:"",
    absoluteUrl:(req,value)=>value||"",audioResponseUrl,serializeArtist:(db,req,row)=>({id:row.id,name:row.name}),serializeSong:(db,req,row)=>({id:row.id,title:row.title}),
    findListenerByToken:(db,req)=>db.listeners.find(r=>r.id===(req.listenerId||1)),
  });
  for(const name of ["nowIso","todayKey","isFutureReleaseDate","publicListener","serializeRelease","serializeReleaseReview","releasePublicationInfo","releaseLinkageValid","releaseReviewIsCurrent","publishRelease","releasePayload","assignReleasePayload","validateReleaseForSubmit","releaseCanBeEdited","submitReleaseForReview","appendAuditLog","requireListener","requireArtist"]) vm.runInContext(extract(name),ctx);
  vm.runInContext(source.slice(source.indexOf("const writeBaselines ="),source.indexOf("function nowIso()")),ctx);
  vm.runInContext(`async ${extract("loadDbWithPublishedReleases")}`,ctx);
  vm.runInContext(source.slice(source.indexOf('app.get("/api/artist-studio/releases/"'),source.indexOf('app.put(\n  "/api/artist-studio/profile/"')),ctx);
  vm.runInContext(source.slice(source.indexOf('app.get("/admin-api/releases"'),source.indexOf('app.get("/admin-api/artists"')),ctx);
  async function call(method,path,{id=1,body={},query={},listenerId=1,files={}}={}) {
    let status=200,data; const headers={};
    const res={status:code=>{status=code;return res;},set:(k,v)=>{headers[k]=v;return res;},json:value=>{data=value;return res;}};
    try {await routes.get(`${method} ${path}`)({params:{id:String(id)},body,query,listenerId,files,adminUser:{username:"fixture-admin",role:"content_admin"},protocol:"https",get:()=>"fixture.invalid"},res);}
    catch(error){if(error.code!=="STALE_WRITE")throw error;status=409;}
    return {status,data,headers};
  }
  const rows=async table=>(await pool.query(`select * from tesohub_music.${table} order by 1`)).rows;
  async function reset(){await pool.query(`truncate ${tables.join(",")} restart identity cascade;
    insert into tesohub_music.listeners(name,email,password_hash,role) values ('Artist','artist@fixture.invalid','fixture-hash','artist'),('Listener','listener@fixture.invalid','keep-hash','listener');
    insert into tesohub_music.artists(name,owner_listener_id) values ('Fixture Artist',1),('Unrelated Artist',null);
    update tesohub_music.listeners set artist_id=1 where id=1;
    insert into tesohub_music.songs(artist_id,title) values (2,'Unrelated song');
    insert into tesohub_music.platform_settings(id) values(1);`);}
  const payload={title:"Review fixture",genre:"Gospel",language:"Ateso",release_date:"2000-01-01",rights_confirmed:true,submit_for_review:true,producer:"Fixture producer",songwriter:"Fixture writer"};
  async function submit(date=payload.release_date){const result=await call("post","/api/artist-studio/releases/",{body:{...payload,release_date:date},files:{audio_upload:[{fieldname:"audio_upload"}],cover_upload:[{fieldname:"cover_upload"}]}});assert.equal(result.status,201);return result.data.id;}
  const approve=id=>call("post","/admin-api/releases/:id/approve",{id});
  async function check(name,fn){await t.test(name,async()=>{await reset();await fn();});}
  async function race(fn){const original=ctx.loadDb;let count=0,release;const barrier=new Promise(r=>{release=r;});ctx.loadDb=async()=>{const db=await original();if(++count<=2){if(count===2)release();await barrier;}return db;};try{return await fn();}finally{ctx.loadDb=original;}}

  await check("submission/detail/filter/Studio status use real records and private proxy without contact data",async()=>{
    const id=await submit();const list=await call("get","/admin-api/releases",{query:{status:"under_review",search:"fixture artist"}});
    assert.equal(list.data.length,1);assert.equal(list.headers["Cache-Control"],"no-store");
    const detail=(await call("get","/admin-api/releases/:id",{id})).data;
    assert.equal(detail.linkage_valid,true);assert.equal(detail.producer,payload.producer);assert.equal(detail.history.length,0);
    assert.equal(detail.release_date,payload.release_date);
    assert.match(detail.audio_file,/\/api\/releases\/\d+\/audio\//);assert.ok(!JSON.stringify(detail).includes("artist@fixture.invalid"));assert.ok(!JSON.stringify(detail).includes("fixture/audio_upload"));
    assert.equal((await call("get","/api/artist-studio/releases/")).data[0].status,"under_review");
    assert.equal((await call("get","/admin-api/releases",{query:{status:"fake"}})).status,400);
  });
  await check("approve once and retry creates one song with matching media and one audit",async()=>{
    const id=await submit();const first=await approve(id),second=await approve(id);assert.equal(first.status,200);assert.equal(second.status,200);
    const release=(await rows("releases"))[0],song=(await rows("songs"))[1];
    assert.equal(song.id,release.public_song_id);assert.equal(song.source_release_id,release.id);assert.equal(song.audio_path,release.audio_path);assert.equal(song.cover_path,release.cover_path);assert.equal(song.artist_id,release.artist_id);
    assert.equal((await rows("songs")).length,2);assert.equal((await rows("admin_audit_logs")).length,1);
    assert.equal((await call("get","/api/artist-studio/releases/")).data[0].status,"published");
  });
  await check("concurrent approvals on independent connections commit one logical publication",async()=>{
    const id=await submit();const results=await race(()=>Promise.all([approve(id),approve(id)]));assert.deepEqual(results.map(r=>r.status),[200,200]);
    assert.equal((await rows("songs")).length,2);assert.equal((await rows("admin_audit_logs")).length,1);
  });
  await check("approval versus rejection commits one decision without orphan song or audit",async()=>{
    const id=await submit();const result=await race(()=>Promise.all([approve(id),call("post","/admin-api/releases/:id/reject",{id,body:{reason:"Incorrect artwork"}})]));
    assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);const published=(await rows("releases"))[0].status==="published";
    assert.equal((await rows("songs")).length,published?2:1);assert.equal((await rows("admin_audit_logs")).length,1);
  });
  await check("meaningful rejection and changes requests preserve upload, expose reason, edit/resubmit same id",async()=>{
    for(const action of ["reject","request-changes"]){
      const id=await submit();assert.equal((await call("post",`/admin-api/releases/:id/${action}`,{id,body:{reason:" "}})).status,400);
      assert.equal((await call("post",`/admin-api/releases/:id/${action}`,{id,body:{reason:"Replace incorrect artwork"}})).status,200);
      const rejected=(await rows("releases")).find(r=>Number(r.id)===id);assert.equal(rejected.status,"rejected");assert.ok(rejected.audio_path);assert.equal(rejected.rejection_reason,"Replace incorrect artwork");
      await p.publishDueReleases();assert.equal((await rows("songs")).length,1);
      const studio=(await call("get","/api/artist-studio/releases/")).data.find(r=>r.id===id);assert.equal(studio.rejection_reason,rejected.rejection_reason);
      const edited=await call("put","/api/artist-studio/releases/:id/",{id,body:{...payload,title:"Corrected"}});assert.equal(edited.status,200);assert.equal(edited.data.id,id);assert.equal(edited.data.status,"under_review");assert.equal(edited.data.approved_at,null);
      assert.equal(edited.data.last_review_reason,"Replace incorrect artwork");
    }
  });
  await check("wrong artist linkage and invalid dates cannot be approved",async()=>{
    const id=await submit();await pool.query("update tesohub_music.releases set artist_id=2 where id=$1",[id]);assert.equal((await approve(id)).status,409);
    await pool.query("update tesohub_music.releases set artist_id=1 where id=$1",[id]);await pool.query("update tesohub_music.listeners set status='suspended' where id=1");assert.equal((await approve(id)).status,409);
    assert.equal(ctx.validateReleaseForSubmit({...payload,audio_file:"a",cover_image:"b",release_date:"2026-02-31"}),"Choose a valid release date.");assert.equal((await rows("songs")).length,1);
  });
  await check("stale review revision rejected and changed metadata during transaction cannot be published",async()=>{
    const id=await submit();assert.equal((await call("post","/admin-api/releases/:id/approve",{id,body:{expected_updated_at:"old"}})).status,409);
    const original=ctx.saveDb;ctx.saveDb=async db=>{await pool.query("update tesohub_music.releases set title='New metadata',audio_path='fixture/new.mp3' where id=$1",[id]);await original(db);};
    try{assert.equal((await approve(id)).status,409);}finally{ctx.saveDb=original;}
    assert.equal((await rows("songs")).length,1);assert.equal((await rows("admin_audit_logs")).length,0);assert.equal((await rows("releases"))[0].title,"New metadata");
  });
  await check("ownership changes after load fail closed at transactional approval",async()=>{
    const id=await submit(),original=ctx.saveDb;ctx.saveDb=async db=>{await pool.query("update tesohub_music.artists set owner_listener_id=2 where id=1");await original(db);};
    try{assert.equal((await approve(id)).status,409);}finally{ctx.saveDb=original;}assert.equal((await rows("songs")).length,1);
  });
  await check("scheduled invalid ownership or incomplete metadata remains private; existing source song is not duplicated",async()=>{
    const id=await submit("2099-01-01");await approve(id);
    await pool.query("update tesohub_music.releases set release_date='2000-01-01',rights_confirmed=false where id=$1",[id]);await p.publishDueReleases();assert.equal((await rows("songs")).length,1);
    await pool.query("update tesohub_music.releases set rights_confirmed=true where id=$1",[id]);await pool.query("update tesohub_music.artists set owner_listener_id=2 where id=1");await p.publishDueReleases();assert.equal((await rows("songs")).length,1);
    await pool.query("update tesohub_music.artists set owner_listener_id=1 where id=1");
    await pool.query("insert into tesohub_music.songs(artist_id,title,source_release_id,status) values(1,'Already linked',$1,'hidden')",[id]);await p.publishDueReleases();assert.equal((await rows("songs")).length,2);assert.equal((await rows("releases"))[0].status,"scheduled");
    await pool.query("update tesohub_music.releases set status='under_review' where id=$1",[id]);assert.equal((await approve(id)).status,409);
  });
  await check("future release cannot publish early; due GET reads never publish; explicit worker publishes once",async()=>{
    const id=await submit("2099-01-01");assert.equal((await approve(id)).data.status,"scheduled");await p.publishDueReleases();assert.equal((await rows("songs")).length,1);
    await pool.query("update tesohub_music.releases set release_date='2000-01-01' where id=$1",[id]);
    for(const path of ["/admin-api/releases","/admin-api/releases/:id","/api/artist-studio/releases/"]) assert.equal((await call("get",path,{id})).status,200);
    await ctx.loadDbWithPublishedReleases();await p.listPublicSongs({});await p.listPublicArtists({});await p.getPublicSong(1);await p.getPublicArtist(1);
    assert.equal((await rows("releases"))[0].status,"scheduled");assert.equal((await rows("songs")).length,1);
    await Promise.all([p.publishDueReleases(),p.publishDueReleases()]);await p.publishDueReleases();assert.equal((await rows("songs")).length,2);assert.equal((await rows("releases"))[0].status,"published");
    assert.equal((await rows("admin_audit_logs")).filter(r=>r.action==="publish_release").length,1);
  });
  await check("review preserves unrelated likes/follows/playlists/account edits",async()=>{
    const id=await submit(),original=ctx.saveDb;ctx.saveDb=async db=>{await p.likeSong({listenerId:2,songId:1});await p.followArtist({listenerId:2,artistId:2});const list=await p.createPlaylist({listenerId:2,name:"Keep playlist"});await p.addSongToPlaylist({listenerId:2,playlistId:list.id,songId:1});await pool.query("update tesohub_music.listeners set name='Changed independently' where id=2");await original(db);};
    try{assert.equal((await approve(id)).status,200);}finally{ctx.saveDb=original;}
    for(const table of ["song_likes","artist_follows","playlists","playlist_songs"])assert.equal((await rows(table)).length,1);
    assert.equal((await rows("listeners"))[1].password_hash,"keep-hash");assert.equal((await rows("listeners"))[1].name,"Changed independently");assert.equal((await rows("songs"))[0].title,"Unrelated song");
  });
  await check("publication audit failure rolls back song and status, and a later worker retry succeeds once",async()=>{
    const id=await submit("2099-01-01");await approve(id);await pool.query("update tesohub_music.releases set release_date='2000-01-01' where id=$1",[id]);
    await pool.query(`create function tesohub_music.fixture_audit_failure() returns trigger language plpgsql as $$
      begin if new.action='publish_release' then raise exception 'synthetic audit failure'; end if; return new; end $$;
      create trigger fixture_audit_failure before insert on tesohub_music.admin_audit_logs for each row execute function tesohub_music.fixture_audit_failure()`);
    try {await assert.rejects(p.publishDueReleases(),/synthetic audit failure/);assert.equal((await rows("songs")).length,1);assert.equal((await rows("releases"))[0].status,"scheduled");}
    finally{await pool.query("drop trigger fixture_audit_failure on tesohub_music.admin_audit_logs; drop function tesohub_music.fixture_audit_failure()");}
    await p.publishDueReleases();await p.publishDueReleases();assert.equal((await rows("songs")).length,2);
  });
  await check("worker skips a scheduled release being rejected on another connection",async()=>{
    const id=await submit("2099-01-01");await approve(id);await pool.query("update tesohub_music.releases set release_date='2000-01-01' where id=$1",[id]);
    const reviewer=await pool.connect();
    try{await reviewer.query("begin");await reviewer.query("update tesohub_music.releases set status='rejected',rejection_reason='Fixture correction' where id=$1",[id]);await p.publishDueReleases();assert.equal((await rows("songs")).length,1);await reviewer.query("commit");}
    finally{await reviewer.query("rollback");reviewer.release();}
    await p.publishDueReleases();assert.equal((await rows("songs")).length,1);assert.equal((await rows("releases"))[0].status,"rejected");
  });
  await check("disabled startup/ticks and due inspection never publish; enabled worker selects only eligible rows",async()=>{
    const due=await submit("2099-01-01"),future=await submit("2099-02-01"),legacy=await submit("2099-03-01"),invalid=await submit("2099-04-01");
    for(const id of [due,future,legacy,invalid]) await approve(id);
    await pool.query("update tesohub_music.releases set release_date='2000-01-01' where id=any($1::bigint[])",[[due,legacy,invalid]]);
    await pool.query("update tesohub_music.releases set status='approved' where id=$1",[legacy]);await pool.query("update tesohub_music.releases set rights_confirmed=false where id=$1",[invalid]);
    const before=JSON.stringify(await rows("releases"));
    for(const [publication,count] of [["approved_scheduled",4],["due",3],["future",1],["eligible",1]]){
      const response=await call("get","/admin-api/releases",{query:{publication}});assert.equal(response.status,200);assert.equal(response.data.length,count);
      assert.ok(!JSON.stringify(response.data).includes("SCHEDULED_PUBLISHER_ENABLED"));
    }
    assert.equal((await call("get","/admin-api/releases/:id",{id:due})).data.publication.eligible,true);
    assert.equal((await call("get","/admin-api/releases/:id",{id:legacy})).data.publication.eligible,false);
    assert.equal((await call("get","/admin-api/releases",{query:{publication:"bad"}})).status,400);
    const workerSource=source.slice(source.indexOf("const SCHEDULED_PUBLISHER_ENABLED ="));
    const worker=value=>{const c=vm.createContext({process:{env:value===undefined?{}:{SCHEDULED_PUBLISHER_ENABLED:value}},USE_SUPABASE_PERSISTENCE:true,supabasePersistence:p,PORT:0,app:{listen(){}},setInterval:()=>({unref(){}}),console:{log(){},error(){throw Error("Worker failed");}}});vm.runInContext(workerSource,c);return c;};
    for(const value of [undefined,"","false","TRUE","yes"]){await worker(value).runScheduledPublication();assert.equal(JSON.stringify(await rows("releases")),before);}
    const enabled=worker("true");await enabled.runScheduledPublication();await enabled.runScheduledPublication();
    assert.equal((await rows("songs")).length,2);assert.equal((await rows("releases")).filter(r=>r.status==="published").length,1);
  });
  await check("only owning artist edits/resubmits same release; media replacement is optional and history survives",async()=>{
    const id=await submit();await call("post","/admin-api/releases/:id/request-changes",{id,body:{reason:"Correct title and replace artwork"}});
    await pool.query("update tesohub_music.listeners set role='artist',artist_id=2 where id=2;update tesohub_music.artists set owner_listener_id=2 where id=2");
    for(const [method,path] of [["put","/api/artist-studio/releases/:id/"],["post","/api/artist-studio/releases/:id/submit/"]])assert.equal((await call(method,path,{id,listenerId:2,body:{...payload,artist:1,listener:1}})).status,404);
    assert.equal((await call("put","/api/artist-studio/releases/:id/",{id,body:{...payload,expected_updated_at:"stale"}})).status,409);
    const old=(await rows("releases"))[0];
    const saved=await call("put","/api/artist-studio/releases/:id/",{id,body:{...payload,title:"Corrected title",submit_for_review:false}});assert.equal(saved.status,200);assert.equal(saved.data.status,"rejected");
    assert.equal((await rows("releases"))[0].audio_path,old.audio_path);assert.equal((await rows("releases"))[0].cover_path,old.cover_path);
    const result=await call("put","/api/artist-studio/releases/:id/",{id,body:{...payload,title:"Corrected title"},files:{audio_upload:[{fieldname:"audio_upload",name:"replacement.mp3"}],cover_upload:[{fieldname:"cover_upload",name:"replacement.png"}]}});
    assert.equal(result.status,200);assert.equal(result.data.id,id);assert.equal(result.data.status,"under_review");assert.equal(result.data.last_review_reason,"Correct title and replace artwork");
    assert.equal((await rows("releases")).length,1);assert.equal((await rows("songs")).length,1);
    const stored=(await rows("releases"))[0];assert.equal(stored.audio_path,"fixture/replacement.mp3");assert.equal(stored.cover_path,"fixture/replacement.png");
    assert.equal((await call("get","/admin-api/releases",{query:{status:"under_review"}})).data[0].id,id);
    assert.equal((await call("get","/admin-api/releases/:id",{id})).data.history[0].reason,"Correct title and replace artwork");
    assert.equal((await call("put","/api/artist-studio/releases/:id/",{id,body:payload})).status,403);
  });
});

test("publication trigger is background-only; no catalog/engagement read or preview triggers it",()=>{
  const persistence=fs.readFileSync(new URL("supabasePersistence.js",root),"utf8");
  assert.equal((persistence.match(/publishDueReleases\(/g)||[]).length,1);
  assert.doesNotMatch(extract("loadDbWithPublishedReleases"),/saveDb|publishDueReleases\(/);
  assert.match(source,/setInterval\(runScheduledPublication, 60000\)\.unref\(\)/);
  assert.match(source,/supabasePersistence\.publishDueReleases\(\)/);
});

test("PostgreSQL DATE calendar values are not shifted by the host timezone",()=>{
  const text=fs.readFileSync(new URL("supabasePersistence.js",root),"utf8").replace(/\r\n/g,"\n");
  const start=text.indexOf("function toDateOnly(");const fn=text.slice(start,text.indexOf("\n}",start)+2);
  for(const TZ of ["Africa/Kampala","America/Los_Angeles","UTC"]){
    const output=execFileSync(process.execPath,["-e",`${fn};process.stdout.write(toDateOnly(new Date(2026,9,8)));`],{env:{...process.env,TZ},encoding:"utf8"});assert.equal(output,"2026-10-08");
  }
});

test("Artist Studio ignores older refresh responses and responses after leaving the screen",async()=>{
  const text=fs.readFileSync(new URL("../../mobile/src/screens/ArtistStudioScreen.js",import.meta.url),"utf8");
  const start=text.indexOf("export default function ArtistStudioScreen");
  const code=text.slice(start,text.indexOf("  const artist = dashboard",start)).replace("export default ","")+"return {loadStudio};}";
  let state=[],focus,cleanup;const pending=[];
  const ctx=vm.createContext({useState:value=>{const i=state.length;state.push(value);return [value,v=>{state[i]=v;}];},useRef:value=>({current:value}),useCallback:fn=>fn,useFocusEffect:fn=>{focus=fn;},
    getArtistStudioDashboard:()=>Promise.resolve({artist:{id:1}}),getArtistStudioReleases:()=>new Promise(resolve=>pending.push(resolve)),BACKEND_CONNECTION_ERROR:"Connection failed"});
  vm.runInContext(code,ctx);const screen=ctx.ArtistStudioScreen({navigation:{}});cleanup=focus();
  const fresh=screen.loadStudio({refresh:true});pending[1]([{id:1,status:"rejected",rejection_reason:"Fix artwork"}]);await fresh;
  pending[0]([{id:1,status:"under_review"}]);await new Promise(resolve=>setImmediate(resolve));assert.equal(state[1][0].status,"rejected");
  const stale=screen.loadStudio();cleanup();pending[2]([{id:1,status:"published"}]);await stale;assert.equal(state[1][0].status,"rejected");
});
