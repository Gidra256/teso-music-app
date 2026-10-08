import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { createSupabasePersistence } from "../supabasePersistence.js";

const root = new URL("../", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8").replace(/\r\n/g, "\n");
const persistenceSource = fs.readFileSync(new URL("supabasePersistence.js", root), "utf8");
const clone = structuredClone;

test("P0-C isolated PostgreSQL concurrency and data integrity", {skip:!process.env.TESO_AUDIO_PGLITE_MODULE}, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.TESO_AUDIO_PGLITE_MODULE).href);
  const sql = new PGlite();
  t.after(() => sql.close());
  await sql.exec("create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);");
  for (const migration of ["001_supabase_initial.sql", "004_support_v1.sql"]) {
    const schema = fs.readFileSync(new URL(`migrations/${migration}`, root), "utf8").replace("create extension if not exists pgcrypto;", "");
    await sql.exec(schema);
  }
  // Model a real one-connection pool: transactions hold the connection until
  // release, whereas pool.query borrows it for only one statement.
  let tail = Promise.resolve();
  const statements = [];
  async function connect() {
    const prior = tail; let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await prior;
    return {query:async (text, values) => {
      statements.push(text);
      const result = await sql.query(text, values);
      return {...result, rowCount:/^\s*(select|with)\b/i.test(text) ? result.rows.length : result.affectedRows ?? result.rows.length};
    }, release:unlock};
  }
  const pool = {connect, query:async (...args) => {
    const c = await connect(); try { return await c.query(...args); } finally { c.release(); }
  }};
  const p = createSupabasePersistence({
    databaseUrl:"postgres://fixture.invalid/unused", supabaseUrl:"https://fixture.invalid", secretKey:"fixture-only",
    buckets:{audio:"music-audio", artwork:"artwork", avatars:"avatars", supportAttachments:"support-attachments"},
    storageUrlFor:(bucket, path) => `/api/storage/${bucket}/${path}`, poolFactory:() => pool,
    storageFetch:async () => { throw new Error("No network allowed in concurrency tests"); },
  });
  const tables = (await sql.query("select tablename from pg_tables where schemaname='tesohub_music'")).rows.map(r => `tesohub_music.${r.tablename}`);
  async function reset() {
    await sql.exec(`truncate ${tables.join(",")} restart identity cascade;
      insert into tesohub_music.listeners(name,email) values ('Listener A','a@fixture.invalid'),('Listener B','b@fixture.invalid');
      insert into tesohub_music.artists(name) values ('Artist X'),('Artist Y');
      insert into tesohub_music.songs(artist_id,title,audio_path) values (1,'Song X','fixture/x.mp3'),(2,'Song Y','fixture/y.mp3');
      insert into tesohub_music.genres(name) values ('Fixture genre');
      insert into tesohub_music.platform_settings(id) values (1);
      insert into tesohub_music.feature_flags(key,enabled) values ('sharing_enabled',true),('support_enabled',true);
      insert into tesohub_music.auth_tokens(id,listener_id,token_hash) values ('fixture-session',1,'fixture-hash');`);
    statements.length = 0;
  }
  const rows = async table => (await sql.query(`select * from tesohub_music.${table} order by 1`)).rows;
  async function editUnrelated(before, collection = "artists") {
    const after = clone(before);
    after[collection][1][collection === "artists" ? "name" : "title"] = "Admin edit";
    await p.saveChanges(before, after);
  }
  async function check(name, fn) { await t.test(name, async () => { await reset(); await fn(); }); }

  await check("A: new follow survives stale unrelated artist edit; counts and unlike/unfollow are never resurrected", async () => {
    const before = await p.loadDb();
    await p.followArtist({artistId:1, listenerId:1});
    await editUnrelated(before);
    assert.equal((await rows("artist_follows")).length, 1);
    assert.equal((await p.getPublicArtist(1)).follower_count, 1);
    const base = await p.loadDb(), next = clone(base);
    await p.unfollowArtist({artistId:1, listenerId:1});
    next.artists[1].name = "Final name";
    await p.saveChanges(base, next);
    assert.equal((await rows("artist_follows")).length, 0);
  });

  await check("B: like and unlike survive unrelated stale song metadata save", async () => {
    const before = await p.loadDb();
    await p.likeSong({songId:1, listenerId:1});
    await editUnrelated(before, "songs");
    assert.equal((await p.getPublicSong(1)).like_count, 1);
    const base = await p.loadDb(), next = clone(base);
    await p.unlikeSong({songId:1, listenerId:1});
    next.songs[1].lyrics = "Fixture lyrics";
    await p.saveChanges(base, next);
    assert.equal((await rows("song_likes")).length, 0);
  });

  await check("C: concurrent playlist/account/session inserts are not deleted by a stale catalog save", async () => {
    const before = await p.loadDb();
    await p.createPlaylist({listenerId:1, name:"New playlist"});
    await p.createListenerAccount({name:"New listener",email:"new@fixture.invalid",phone:"",passwordHash:"fixture",sessionId:"new-session",tokenHash:"new-hash",deviceId:"",deviceName:""});
    await editUnrelated(before, "songs");
    assert.equal((await rows("playlists")).length, 1);
    assert.equal((await rows("listeners")).length, 3);
    assert.equal((await rows("auth_tokens")).length, 2);
  });

  await check("D: playlist add/remove/rename/delete survive stale catalog edits", async () => {
    const playlist = await p.createPlaylist({listenerId:1, name:"Fixture list"});
    await p.addSongToPlaylist({listenerId:1, playlistId:playlist.id, songId:1});
    let base = await p.loadDb();
    await p.removeSongFromPlaylist({listenerId:1, playlistId:playlist.id, songId:1});
    await p.addSongToPlaylist({listenerId:1, playlistId:playlist.id, songId:2});
    await p.updatePlaylist({listenerId:1,playlistId:playlist.id,name:"Renamed"});
    await editUnrelated(base);
    assert.deepEqual((await rows("playlist_songs")).map(r => Number(r.song_id)), [2]);
    assert.equal((await rows("playlists"))[0].name, "Renamed");
    base = await p.loadDb();
    await p.deletePlaylist(1, playlist.id);
    const next = clone(base); next.songs[1].lyrics = "Updated";
    await p.saveChanges(base, next);
    assert.equal((await rows("playlists")).length, 0);
    assert.equal((await rows("playlist_songs")).length, 0);
  });

  await check("E: profile/account and revoked sessions survive unrelated admin edit", async () => {
    const admin = await p.loadDb(), listener = await p.loadDb(), next = clone(listener);
    next.listeners[0].name = "Updated listener"; next.listeners[0].phone = "fixture-phone";
    next.authTokens = [];
    await p.saveChanges(listener, next);
    await editUnrelated(admin);
    assert.equal((await rows("listeners"))[0].name, "Updated listener");
    assert.equal((await rows("listeners"))[0].phone, "fixture-phone");
    assert.equal((await rows("auth_tokens")).length, 0);
  });

  await check("F: new application, role and foreign-key linkage survive stale catalog save", async () => {
    const admin = await p.loadDb(), base = await p.loadDb(), next = clone(base);
    next.artistApplications.push({id:99, listener:1, artist_name:"Applicant", status:"pending"});
    next.listeners[0].role = "artist_pending"; next.listeners[0].artist_application_id = 99;
    await p.saveChanges(base, next);
    await editUnrelated(admin);
    const application = (await rows("artist_applications"))[0];
    assert.equal((await rows("listeners"))[0].role, "artist_pending");
    assert.equal(Number((await rows("listeners"))[0].artist_application_id), Number(application.id));
    assert.equal(next.artistApplications[0].id, Number(application.id));
  });

  await check("G: new and updated Studio release survive stale admin save", async () => {
    const admin = await p.loadDb(), base = await p.loadDb(), next = clone(base);
    next.releases.push({id:99, artist:1, listener:1, title:"Draft", status:"draft"});
    await p.saveChanges(base, next);
    const editBase = await p.loadDb(), edit = clone(editBase);
    edit.releases[0].title = "Ready for review"; edit.releases[0].status = "under_review";
    await p.saveChanges(editBase, edit);
    await editUnrelated(admin);
    assert.equal((await rows("releases"))[0].title, "Ready for review");
    assert.equal((await rows("releases"))[0].status, "under_review");
  });

  await check("H: two stale admins editing different rows both survive with no unrelated row updates", async () => {
    const a = await p.loadDb(), b = await p.loadDb(), aa = clone(a), bb = clone(b);
    aa.artists[0].name = "Edited X"; bb.artists[1].name = "Edited Y";
    statements.length = 0;
    await Promise.all([p.saveChanges(a, aa), p.saveChanges(b, bb)]);
    assert.deepEqual((await rows("artists")).map(r => r.name), ["Edited X", "Edited Y"]);
    const writes = statements.filter(s => /^(update|delete|insert) /i.test(s));
    assert.equal(writes.length, 2); assert.ok(writes.every(s => s.startsWith("update tesohub_music.artists set name =")));
  });

  await check("actual Admin artist-edit handler and server bridge preserve a follow made after its read", async () => {
    const read = await p.loadDb();read.nextIds={adminAuditLog:1};
    let handler, output;
    const ctx=vm.createContext({USE_SUPABASE_PERSISTENCE:true,structuredClone,
      supabasePersistence:{loadDb:async()=>clone(read),saveChanges:(...args)=>p.saveChanges(...args)},
      normalizeDb:db=>db,requireAdminPermission:()=>()=>{},upload:{single:()=>()=>{}},
      app:{put:(route,...handlers)=>{handler=handlers.at(-1);}},
      allowFeaturedChange:()=>true,validateUploadSettings:()=>null,uploadUrlFor:async()=>"",
      adminCan:()=>true,boolValue:Boolean,ARTIST_STATUSES:new Set(["active","suspended","removed"]),
      nowIso:()=>new Date().toISOString(),serializeArtist:(db,req,row)=>row,
      appendAuditLog:(db)=>db.adminAuditLogs.push({id:db.nextIds.adminAuditLog++,action:"fixture_edit"}),
    });
    const bridgeStart=server.indexOf("const writeBaselines ="), bridgeEnd=server.indexOf("function nowIso()",bridgeStart);
    vm.runInContext(server.slice(bridgeStart,bridgeEnd),ctx);
    const load=ctx.loadDb;
    ctx.loadDb=async()=>{const db=await load();await p.followArtist({artistId:1,listenerId:1});return db;};
    const start=server.indexOf('app.put(\n  "/admin-api/artists/:id"'),end=server.indexOf('app.delete("/admin-api/artists/:id"',start);
    assert.ok(start>0&&end>start);vm.runInContext(server.slice(start,end),ctx);
    await handler({params:{id:"2"},body:{name:"Actual route edit"}}, {json:value=>{output=value;},status:()=>{throw new Error("Unexpected route failure");}});
    assert.equal(output.name,"Actual route edit");
    assert.equal((await rows("artists"))[1].name,"Actual route edit");
    assert.equal((await rows("artist_follows")).length,1);
    assert.equal((await rows("admin_audit_logs")).length,1);
  });

  await check("same-field stale edits conflict atomically; different-field edits merge", async () => {
    const base = await p.loadDb(), a = clone(base), b = clone(base), c = clone(base);
    a.artists[0].name = "First"; b.artists[0].name = "Second"; c.artists[0].bio = "Independent bio";
    b.adminAuditLogs.push({id:10,action:"conflicting_edit"});
    await p.saveChanges(base, a);
    await assert.rejects(p.saveChanges(base, b), e => e.code === "STALE_WRITE");
    await p.saveChanges(base, c);
    assert.equal((await rows("artists"))[0].name, "First");
    assert.equal((await rows("artists"))[0].bio, "Independent bio");
    assert.equal((await rows("admin_audit_logs")).length, 0);
  });

  await check("concurrent inserts use sequences and remap all workflow and audit references", async () => {
    const a = await p.loadDb(), b = await p.loadDb(), aa = clone(a), bb = clone(b);
    for (const [db, name] of [[aa,"New A"],[bb,"New B"]]) {
      db.artists.push({id:3,name,status:"active"});
      db.songs.push({id:3,artist:3,title:name,status:"published",source_release_id:1});
      db.releases.push({id:1,artist:3,listener:1,title:name,status:"published",public_song:3});
      db.adminAuditLogs.push({id:1,action:"publish",target_type:"artist",target_id:3,details:{artist_id:3,public_song:3}});
    }
    await Promise.all([p.saveChanges(a, aa), p.saveChanges(b, bb)]);
    const artists = await rows("artists"), songs = await rows("songs"), releases = await rows("releases"), audit = await rows("admin_audit_logs");
    assert.equal(artists.length, 4); assert.equal(songs.length, 4); assert.equal(releases.length, 2); assert.equal(audit.length, 2);
    for (const release of releases) {
      const song = songs.find(s => s.id === release.public_song_id);
      assert.equal(song.artist_id, release.artist_id); assert.equal(song.source_release_id, release.id);
      assert.equal(song.title, release.title);
    }
    for (const entry of audit) assert.equal(entry.details.artist_id, Number(entry.target_id));
    assert.notEqual(aa.artists[2].id, bb.artists[2].id);
  });

  await check("approval versus stale Studio edits rejects invalid lifecycle changes", async () => {
    await sql.exec("insert into tesohub_music.releases(artist_id,listener_id,title,status) values (1,1,'Review','under_review');");
    const base = await p.loadDb(), approve = clone(base), stale = clone(base);
    approve.songs.push({id:3,artist:1,title:"Published",status:"published",source_release_id:1});
    approve.releases[0].status = "published"; approve.releases[0].public_song = 3;
    approve.adminAuditLogs.push({id:1,action:"approve",target_type:"release",target_id:1,details:{public_song:3}});
    await p.saveChanges(base, approve);
    stale.releases[0].title = "Stale title";
    await assert.rejects(p.saveChanges(base, stale), e => e.code === "STALE_WRITE");
    assert.equal((await rows("songs")).length, 3);
    assert.equal((await rows("releases"))[0].status, "published");
  });

  await check("hard delete affects only owned dependents and cannot resurrect or clobber unrelated rows", async () => {
    await p.likeSong({songId:1,listenerId:1}); await p.likeSong({songId:2,listenerId:1});
    const playlist = await p.createPlaylist({listenerId:1,name:"Keep playlist"});
    await p.addSongToPlaylist({listenerId:1,playlistId:playlist.id,songId:1});
    await p.addSongToPlaylist({listenerId:1,playlistId:playlist.id,songId:2});
    const base = await p.loadDb(), stale = clone(base), remove = clone(base);
    remove.songs = remove.songs.filter(s => s.id !== 1); remove.songLikes = remove.songLikes.filter(l => l.song !== 1);
    await p.saveChanges(base, remove);
    assert.deepEqual((await rows("song_likes")).map(r=>Number(r.song_id)), [2]);
    assert.deepEqual((await rows("playlist_songs")).map(r=>Number(r.song_id)), [2]);
    stale.songs[0].title = "Resurrection";
    await assert.rejects(p.saveChanges(base, stale), e => e.code === "STALE_WRITE");
    assert.equal((await rows("playlists")).length, 1);
  });

  await check("settings/flags, genres, reports and audit use scoped writes and preserve concurrent fields", async () => {
    const base = await p.loadDb(), a = clone(base), b = clone(base);
    a.platformSettings.maintenance_message = "Updated message";
    a.platformSettings.feature_flags.sharing_enabled = false;
    a.genres[0].name = "Changed genre";
    a.reports.push({id:1,target_type:"song",target_id:1,reason:"Fixture report",status:"open"});
    a.adminAuditLogs.push({id:1,action:"fixture"});
    b.platformSettings.app_announcement = "Announcement";
    b.platformSettings.feature_flags.support_enabled = false;
    await p.saveChanges(base, a); await p.saveChanges(base, b);
    const settings = (await rows("platform_settings"))[0];
    assert.equal(settings.maintenance_message,"Updated message"); assert.equal(settings.app_announcement,"Announcement");
    assert.ok((await rows("feature_flags")).every(f=>f.enabled===false));
    assert.equal((await rows("reports")).length,1); assert.equal((await rows("admin_audit_logs")).length,1);
  });

  await check("play increments are atomic and unrelated song metadata preserves them", async () => {
    const base = await p.loadDb();
    await Promise.all(Array.from({length:8}, () => p.recordSongPlay(1)));
    const edit = clone(base); edit.songs[0].lyrics = "Lyrics only";
    await p.saveChanges(base, edit);
    assert.equal(Number((await rows("songs"))[0].play_count),8);
    await sql.exec("update tesohub_music.songs set status='hidden' where id=1");
    assert.equal(await p.recordSongPlay(1),null);
    assert.equal(Number((await rows("songs"))[0].play_count),8);
  });

  await check("legacy whole-snapshot writer is unavailable; missing baseline fails without SQL writes", async () => {
    assert.equal(p.saveDb,undefined);
    statements.length = 0;
    await assert.rejects(p.saveChanges(null, await p.loadDb()));
    assert.ok(!statements.some(s=>/^(insert|update|delete) /i.test(s)));
    assert.doesNotMatch(persistenceSource,/deleteMissing|async function saveDb\(/);
  });

  await check("no-op saves do not overwrite direct audit/support/history or even issue table writes", async () => {
    const before = await p.loadDb();
    await p.recordAdminAuditLog({action:"support_fixture",adminRole:"support_admin"});
    await sql.exec("insert into tesohub_music.listening_history(song_id,listener_id) values(1,1); insert into tesohub_music.support_tickets(reference,listener_id,category,subject,message) values ('TSH-FIXTURE',1,'other','Fixture','Fixture');");
    statements.length = 0;
    await p.saveChanges(before,clone(before));
    assert.ok(!statements.some(s=>/^(insert|update|delete) /i.test(s)));
    assert.equal((await rows("admin_audit_logs")).length,1);
    assert.equal((await rows("listening_history")).length,1);
    assert.equal((await rows("support_tickets")).length,1);
  });

  await check("Support replies/notes/assignment and privacy survive unrelated catalog saves", async () => {
    const stale = await p.loadDb();
    const ticket = await p.createSupportTicket({reference:"TSH-CONCURRENT",listenerId:1,category:"other",subject:"Fixture",message:"Help"});
    await p.addSupportAdminReply({ticketIdentifier:ticket.id,adminUsername:"fixture",message:"Public answer"});
    await p.addSupportTicketReply({ticketIdentifier:ticket.id,listenerId:1,message:"Listener response"});
    await p.addSupportInternalNote({ticketIdentifier:ticket.id,adminUsername:"fixture",note:"Internal only"});
    await p.updateSupportTicketForAdmin({ticketIdentifier:ticket.id,assignedTo:"fixture",changedBy:"fixture",status:"in_progress"});
    await editUnrelated(stale);
    const own = await p.getSupportTicketForListener(1,ticket.id);
    assert.equal(own.messages.length,3);
    assert.equal(own.status,"in_progress");
    assert.equal(own.internal_notes,undefined);
    assert.equal(await p.getSupportTicketForListener(2,ticket.id),null);
    assert.equal((await rows("support_internal_notes")).length,1);
    assert.equal((await rows("support_assignments")).length,1);
  });

  await check("timestamp precision, monotonic activity, and null original fields remain safe", async () => {
    await sql.exec("update tesohub_music.auth_tokens set created_at='2026-01-01T00:00:00.123456Z',last_active_at='2026-01-02T00:00:00Z';");
    const base=await p.loadDb(), after=clone(base);
    after.authTokens[0].last_active_at="2026-01-01T00:00:00Z";
    await p.saveChanges(base,after);
    assert.equal((await rows("auth_tokens"))[0].last_active_at.toISOString(),"2026-01-02T00:00:00.000Z");
    const revokeBase=await p.loadDb(), revoke=clone(revokeBase); revoke.authTokens=[];
    await p.saveChanges(revokeBase,revoke);
    assert.equal((await rows("auth_tokens")).length,0);
    const raw=await p.loadDb(), normalized=clone(raw);
    normalized.artists[0].updated_at=normalized.artists[0].created_at;
    const edit=clone(normalized);edit.artists[0].name="Null-safe edit";
    await p.saveChanges(normalized,edit,raw);
    assert.equal((await rows("artists"))[0].name,"Null-safe edit");
    assert.equal((await rows("artists"))[0].updated_at,null);
  });

  await check("normalization defaults do not become writes or overwrite actual defaults", async () => {
    const raw=await p.loadDb(), normalized=clone(raw);
    normalized.platformSettings.feature_flags.ui_default=true;
    normalized.genres.push({id:99,name:"Not persisted",active:true});
    const edit=clone(normalized);edit.artists[1].name="Only artist";
    await p.saveChanges(normalized,edit,raw);
    assert.equal((await rows("genres")).length,1);
    assert.equal((await rows("feature_flags")).length,2);
    const second=clone(normalized);second.platformSettings.feature_flags.ui_default=false;
    second.genres[1].name="Explicitly edited default";
    await p.saveChanges(normalized,second,raw);
    assert.equal((await rows("genres")).length,2);
    assert.equal((await rows("feature_flags")).find(f=>f.key==="ui_default").enabled,false);
  });

  await check("deletion and transaction constraint failures leave unrelated rows and audit intact", async () => {
    const base=await p.loadDb(), invalid=clone(base);
    invalid.artists[0].name="Must roll back";
    invalid.songs.push({id:99,artist:999,title:"Invalid FK"});
    invalid.adminAuditLogs.push({id:99,action:"must_not_commit"});
    await assert.rejects(p.saveChanges(base,invalid),e=>e.code==="STALE_WRITE");
    assert.equal((await rows("artists"))[0].name,"Artist X");
    assert.equal((await rows("admin_audit_logs")).length,0);
    assert.equal(invalid.songs[2].id,99,"No generated IDs reflected after rollback");
    const remove=clone(base);remove.platformSettings.feature_flags.sharing_enabled=undefined;
    delete remove.platformSettings.feature_flags.sharing_enabled;
    await p.saveChanges(base,remove);
    assert.deepEqual((await rows("feature_flags")).map(f=>f.key),["support_enabled"]);
  });

  await check("due publication is scoped, idempotent, and preserves engagement/account records", async () => {
    await sql.exec("insert into tesohub_music.releases(artist_id,listener_id,title,status,release_date) values (1,1,'Due','scheduled','2000-01-01');");
    await p.followArtist({artistId:1,listenerId:1});
    await p.likeSong({songId:1,listenerId:1});
    await Promise.all([p.listPublicSongs(),p.listPublicSongs()]);
    assert.equal((await rows("songs")).length,3);
    assert.equal((await rows("releases"))[0].status,"published");
    assert.equal((await rows("artist_follows")).length,1);
    assert.equal((await rows("song_likes")).length,1);
    assert.equal((await rows("listeners")).length,2);
    assert.match(persistenceSource,/public_song_id is null\s+for update skip locked/);
  });
});

test("server bridge tracks immutable baselines, preserves JSON saves and maps conflicts to safe 409", async () => {
  const calls = [];
  const context = vm.createContext({USE_SUPABASE_PERSISTENCE:true,structuredClone,
    supabasePersistence:{loadDb:async()=>({artists:[], marker:"raw"}),saveChanges:async(before,after,stored)=>calls.push({before,after,stored})},
    normalizeDb:db=>({...db, marker:"normalized"}),ensureDb:async()=>{},DATA_DIR:"fixture",DB_PATH:"fixture.json",
    fs:{mkdir:async()=>{},writeFile:async(...args)=>calls.push(args),readFile:async()=>'{"artists":[]}'},
  });
  const start=server.indexOf("const writeBaselines ="), end=server.indexOf("function nowIso()",start);
  vm.runInContext(server.slice(start,end),context);
  const db=await context.loadDb();db.artists.push({id:1,name:"New"});await context.saveDb(db);
  assert.equal(calls[0].before.artists.length,0);assert.equal(calls[0].stored.marker,"raw");
  await assert.rejects(context.saveDb(db),/tracked baseline/);
  await assert.rejects(context.saveDb({artists:[]}),/tracked baseline/);
  context.USE_SUPABASE_PERSISTENCE=false;
  await context.saveDb({artists:[]});assert.equal(JSON.parse(calls.at(-1)[1]).artists.length,0);
  let errorHandler, status, body;
  context.app={use:handler=>{errorHandler=handler;}};
  const errorStart=server.indexOf("app.use((error, req, res, next)"),errorEnd=server.indexOf("await ensureDb();",errorStart);
  vm.runInContext(server.slice(errorStart,errorEnd),context);
  const res={headersSent:false,status:value=>{status=value;return res;},json:value=>{body=value;}};
  errorHandler({code:"STALE_WRITE",message:"Must not expose SQL details"},{},res,()=>assert.fail("Unexpected next"));
  assert.equal(status,409);
  assert.equal(body.detail,"This record changed while saving. Reload and try again.");
});
