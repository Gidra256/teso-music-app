import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { AUDIO_COOKIE, canReadAudio, makeAudioCookie, validAudioCookie } from "../audioAccess.js";

const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const roles = {
  super_admin: ["*"],
  content_admin: ["applications", "artists", "catalog", "discovery", "genres", "releases"],
  moderator: ["reports", "users", "artists", "catalog"],
  support_admin: ["support:view", "support:reply", "support:note", "support:update"],
};
// Independent expected policy; registration coverage fails if a route is added or omitted.
const policy = [
  ["post", "/admin-api/login", []],
  ["get", "/admin-api/me", []],
  ["delete", "/admin-api/audio-preview-session", []],
  ["get", "/admin-api/dashboard", ["artists", "catalog", "releases", "reports"]],
  ["get", "/admin-api/support/tickets", ["support:view"]],
  ["get", "/admin-api/support/tickets/:id", ["support:view"]],
  ["post", "/admin-api/support/tickets/:id/replies", ["support:reply"]],
  ["post", "/admin-api/support/tickets/:id/notes", ["support:note"]],
  ["patch", "/admin-api/support/tickets/:id", ["support:update"]],
  ["get", "/admin-api/support/tickets/:id/attachments/:kind/:attachmentId", ["support:view"]],
  ["get", "/admin-api/users", ["users"]],
  ["post", "/admin-api/users/:id/suspend", ["users"]],
  ["post", "/admin-api/users/:id/restore", ["users"]],
  ["post", "/admin-api/users/:id/revoke-sessions", ["*"]],
  ["get", "/admin-api/genres", ["genres", "catalog"]],
  ["post", "/admin-api/genres", ["genres"]],
  ["put", "/admin-api/genres/:id", ["genres"]],
  ["post", "/admin-api/genres/:id/activate", ["genres"]],
  ["post", "/admin-api/genres/:id/deactivate", ["genres"]],
  ["get", "/admin-api/platform-settings", ["settings"]],
  ["put", "/admin-api/platform-settings", ["settings"]],
  ["get", "/admin-api/feature-flags", ["settings"]],
  ["put", "/admin-api/feature-flags", ["settings"]],
  ["get", "/admin-api/reports", ["reports"]],
  ["post", "/admin-api/reports/:id/status", ["reports"]],
  ["get", "/admin-api/discovery", ["discovery"]],
  ["get", "/admin-api/platform-health", ["*"]],
  ["get", "/admin-api/audit-log", ["*"]],
  ["get", "/admin-api/persistence-export", ["*"]],
  ["get", "/admin-api/supabase-migration/jobs", ["*"]],
  ["get", "/admin-api/supabase-migration/jobs/:id", ["*"]],
  ["post", "/admin-api/supabase-migration/schema", ["*"]],
  ["post", "/admin-api/supabase-migration/migrate", ["*"]],
  ["post", "/admin-api/supabase-migration/validate", ["*"]],
  ["get", "/admin-api/artist-applications", ["applications"]],
  ["get", "/admin-api/artist-applications/:id", ["applications"]],
  ["post", "/admin-api/artist-applications/:id/approve", ["applications"]],
  ["post", "/admin-api/artist-applications/:id/reject", ["applications"]],
  ["post", "/admin-api/artist-applications/:id/request-changes", ["applications"]],
  ["get", "/admin-api/releases", ["releases"]],
  ["get", "/admin-api/releases/:id", ["releases"]],
  ["post", "/admin-api/releases/:id/approve", ["releases"]],
  ["post", "/admin-api/releases/:id/reject", ["releases"]],
  ["post", "/admin-api/releases/:id/request-changes", ["releases"]],
  ["get", "/admin-api/artists", ["artists"]],
  ["post", "/admin-api/artists", ["artists"]],
  ["put", "/admin-api/artists/:id", ["artists"]],
  ["delete", "/admin-api/artists/:id", ["artists"]],
  ["post", "/admin-api/artists/:id/suspend", ["artists"]],
  ["post", "/admin-api/artists/:id/restore", ["artists"]],
  ["post", "/admin-api/artists/:id/feature", ["discovery"]],
  ["post", "/admin-api/artists/:id/unfeature", ["discovery"]],
  ["get", "/admin-api/songs", ["catalog"]],
  ["post", "/admin-api/songs", ["catalog"]],
  ["put", "/admin-api/songs/:id", ["catalog"]],
  ["delete", "/admin-api/songs/:id", ["catalog"]],
  ["post", "/admin-api/songs/:id/hide", ["catalog"]],
  ["post", "/admin-api/songs/:id/restore", ["catalog"]],
  ["post", "/admin-api/songs/:id/remove", ["catalog"]],
  ["post", "/admin-api/songs/:id/feature", ["discovery"]],
  ["post", "/admin-api/songs/:id/unfeature", ["discovery"]],
];
const confirmations = {
  schema: "APPLY SUPABASE SCHEMA", migrate: "MIGRATE RENDER DATA TO SUPABASE", validate: "VALIDATE SUPABASE MIGRATION",
};
const plain = value => JSON.parse(JSON.stringify(value));
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

async function fixture(t, role, gateOnly = false) {
  const calls = [];
  const record = name => calls.push(name);
  const db = {
    listeners: [{ id: 1, name: "Fixture listener", role: "listener", status: "active", password_hash: "fixture-password-hash" }],
    authTokens: [{ listener: 1, token_hash: "fixture-session-hash" }],
    artists: [{ id: 1, name: "Fixture artist", status: "active", is_featured: true }],
    songs: [{ id: 1, title: "Fixture song", artist: 1, status: "published", is_featured: true }],
    releases: [{ id: 1, artist: 1, status: "under_review", release_date: "2099-01-01" }],
    genres: [{ id: 1, name: "Gospel", active: true, position: 1, created_at: "fixture-date" }, { id: 2, name: "Inactive", active: false }],
    artistApplications: [], reports: [], artistFollows: [], songLikes: [], adminAuditLogs: [],
    nextIds: { artist: 2, song: 2, genre: 3 }, platformSettings: { feature_flags: {} },
  };
  const ticket = { id: 1, reference: "TSH-FIXTURE", status: "open", user: { id: 1, name: "Fixture listener" }, messages: [], internal_notes: [] };
  const support = {
    listSupportTicketsForAdmin: async () => { record("supportRead"); return [ticket]; },
    getSupportTicketForAdmin: async () => { record("supportRead"); return ticket; },
    addSupportAdminReply: async input => { record("supportReply"); ticket.messages.push({message:input.message}); return {ticket}; },
    addSupportInternalNote: async input => { record("supportNote"); ticket.internal_notes.push({note:input.note}); return {ticket_id:1}; },
    updateSupportTicketForAdmin: async input => { record("supportUpdate"); ticket.status=input.status; return ticket; },
    supportAttachmentForAdmin: async () => { record("supportAttachment"); return {fixture:true}; },
    streamSupportAttachment: async (_,req,res) => { record("supportStream"); res.type("text").send("synthetic fixture"); },
  };
  const registrations = [];
  const registrationApp = Object.fromEntries(["get","post","put","patch","delete"].map(method=>[method,(route,...handlers)=>registrations.push({method,route,handlers})]));
  const noop = (req,res,next) => { record("uploadParse"); next(); };
  const ctx = vm.createContext({
    app: registrationApp, process: {env:role === undefined ? {} : {ADMIN_ROLE:role}}, ADMIN_TOKEN: "fixture-admin-token", ADMIN_USERNAME:"fixture-admin", ADMIN_PASSWORD:"fixture-password",
    cleanText: value=>String(value||"").trim(), boolValue: value=>[true,"true","1",1,"on"].includes(value),
    USE_SUPABASE_PERSISTENCE:true, PERSISTENCE_BACKEND:"supabase", AUDIO_COOKIE:"tesohub_audio_preview", upload:{single:()=>noop,fields:()=>noop},
    loadDb: async()=>{record("load");return db;}, loadDbWithPublishedReleases:async()=>{record("publicationRead");return db;},
    saveDb:async()=>{record("save");}, setAudioPreviewCookie:()=>record("previewCookie"),
    migrationJobs:new Map(), MIGRATION_CONFIRMATIONS:confirmations,
    startMigrationJob:(kind)=>{record("migration");return {kind,status:"fixture"};},
    migrationJobSnapshot:job=>job, nowIso:()=>"2026-10-08T00:00:00.000Z",
    appendAuditLog:()=>record("audit"), auditSupportAction:async()=>record("supportAudit"),
    supabasePersistence:support, supportTicketListPayload:rows=>rows, attachSupportUrls:row=>row,
    SUPPORT_TICKET_STATUSES:new Set(["open","in_progress","waiting_on_user","resolved","closed"]), SUPPORT_TICKET_PRIORITIES:new Set(["normal","high"]),
    ARTIST_STATUSES:new Set(["active","suspended","removed"]), SONG_STATUSES:new Set(["published","hidden","removed"]), REPORT_STATUSES:new Set(["open","resolved"]),
    serializeArtist:(_,req,row)=>row, serializeSong:(_,req,row)=>row, serializeRelease:(_,req,row)=>row,
    serializeAdminUser:(_,row)=>({id:row.id,status:row.status,role:row.role}), serializeAuditLog:row=>row,
    serializeReport:(_,row)=>row, serializeArtistApplication:(_,req,row)=>row,
    sortArtists:rows=>rows, sortSongs:rows=>rows, dashboardPayload:()=>({total_users:1}),
    platformSettingsFor:db=>db.platformSettings, featureFlagsFor:db=>db.platformSettings.feature_flags,
    normalizePlatformSettings:settings=>settings, settingsPayloadFromBody:(req,current)=>({...current,...req.body}),
    validateReleaseForSubmit:()=>null, isFutureReleaseDate:()=>true, publishRelease:()=>{throw new Error("Unexpected publication");},
    validateUploadSettings:()=>null, uploadUrlFor:async()=>"", audioInput:value=>value||"", mediaPath:value=>value||"",
    genrePayload:req=>({genre:req.body.genre||"Gospel",genre_note:""}), numberOrZero:value=>Number(value||0),
  });
  const roleStart=source.indexOf("const ADMIN_ROLES =");
  const roleEnd=source.indexOf("};",source.indexOf("const ADMIN_ROLE_PERMISSIONS ="))+2;
  const authStart=source.indexOf("function configuredAdminRole()");
  const authEnd=source.indexOf("const migrationJobs =",authStart);
  vm.runInContext(source.slice(roleStart,roleEnd)+"\n"+source.slice(authStart,authEnd)+"\n"+
    functionSource("serializeGenre")+"\n"+functionSource("requireMigrationConfirmation")+"\n"+
    source.slice(source.indexOf('app.post("/admin-api/login"'),source.indexOf("app.use((error, req, res, next)")),ctx);
  const app=express();app.use(express.json());
  for(const {method,route,handlers} of registrations){
    const selected=gateOnly ? [...handlers.slice(0,-1),(req,res)=>res.json({allowed:true})] : handlers;
    app[method](route,...selected.map(fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next)));
  }
  app.use((error,req,res,next)=>{record("error");res.status(500).json({detail:"Fixture handler failed"});});
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const request=async(method,route,body,token="fixture-admin-token",headers={})=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method:method.toUpperCase(),headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`} : {}),...headers},...(body!==undefined && !["get","head"].includes(method)?{body:JSON.stringify(body)}:{})});
    const text=await response.text();let json;try{json=JSON.parse(text);}catch{}
    return {status:response.status,json,text,setCookie:response.headers.get("set-cookie")};
  };
  return {request,db,calls,ticket,registrations,ctx};
}

for (const role of Object.keys(roles)) {
  test(`explicit configured role authenticates without privilege substitution: ${role}`, async t => {
    const f = await fixture(t, role);
    assert.equal(vm.runInContext("configuredAdminRole()", f.ctx), role);
    const login = await f.request("post", "/admin-api/login", {username:"fixture-admin", password:"fixture-password"});
    assert.equal(login.status, 200);
    assert.equal(login.json.role, role);
    assert.deepEqual(login.json.permissions, roles[role]);
    const me = await f.request("get", "/admin-api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.admin.role, role);
    assert.deepEqual(me.json.admin.permissions, roles[role]);
  });
}

const invalidRoles = [
  ["missing", undefined], ["empty", ""], ["whitespace-only", " \t\n"],
  ["unknown", "unknown"], ["unsupported", "admin"], ["case-invalid", "SUPER_ADMIN"],
  ["mixed-case", "Super_Admin"], ["padded", " super_admin "], ["quoted", '"super_admin"'],
  ["multiple roles", "support_admin,super_admin"], ["wildcard", "*"],
  ["prototype constructor", "constructor"], ["prototype key", "__proto__"], ["prototype method", "toString"],
  ["null", null], ["non-string array", ["super_admin"]], ["non-string object", {role:"super_admin"}],
];

for (const [label, role] of invalidRoles) {
  test(`invalid configured role fails closed on login and every Admin route: ${label}`, async t => {
    const f = await fixture(t, role);
    assert.equal(vm.runInContext("configuredAdminRole()", f.ctx), null);
    assert.deepEqual(plain(vm.runInContext("publicAdminUser()", f.ctx)), {
      username:"fixture-admin", role:null, permissions:[],
    });
    Object.assign(f.ctx, {
      validAudioCookie,
      getBearerToken:req => (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim(),
    });
    vm.runInContext(functionSource("audioAccessFor"), f.ctx);
    for (const headers of [
      {authorization:"Bearer fixture-admin-token"},
      {cookie:`${AUDIO_COOKIE}=${makeAudioCookie("fixture-admin-token")}`},
    ]) {
      const access = f.ctx.audioAccessFor({get:name => headers[name]});
      assert.deepEqual(plain(access.reviewer), {releases:false, catalog:false});
      assert.equal(canReadAudio({kind:"release", status:"under_review", is_public:false}, access.reviewer), false);
      assert.equal(canReadAudio({kind:"song", status:"hidden", is_public:false}, access.reviewer), false);
      assert.equal(canReadAudio({is_public:true}, access.reviewer), true);
    }
    for (const permission of new Set(Object.values(roles).flat().concat("settings"))) {
      f.ctx.requestedPermission = permission;
      assert.equal(vm.runInContext("adminCan(publicAdminUser(), requestedPermission)", f.ctx), false);
      f.ctx.invalidIdentity = {role};
      assert.equal(vm.runInContext("adminCan(invalidIdentity, requestedPermission)", f.ctx), false);
    }
    const before = plain(f.db);
    for (const [method, route] of policy) {
      let url = route.replaceAll(":id", "1").replace(":kind", "ticket").replace(":attachmentId", "1");
      if (method === "delete" && /\/(artists|songs)\//.test(url)) url += "?confirm=DELETE%20FOREVER";
      if (url === "/admin-api/persistence-export") url += "?include_sensitive=true&confirm=EXPORT%20RAW%20HASHES";
      const kind = url.split("/").at(-1);
      const body = {username:"fixture-admin", password:"fixture-password", role:"super_admin", confirm:confirmations[kind]};
      for (const verb of method === "get" ? ["get", "head"] : [method]) {
        const response = await f.request(verb, url, body, "fixture-admin-token", {"X-Admin-Role":"super_admin"});
        assert.equal(response.status, 403, `${verb} ${route}`);
        if (verb !== "head") assert.deepEqual(response.json, {detail:"Forbidden"});
        assert.equal(response.setCookie, null, "Invalid config must not issue an audio-preview cookie");
      }
    }
    assert.deepEqual(f.calls, [], "No DB, upload, migration, audit or preview-cookie work on denial");
    assert.deepEqual(plain(f.db), before);
  });
}

for(const [role,permissions] of Object.entries(roles)){
  test(`permission matrix: ${role}, every Admin route and GET/HEAD`,async t=>{
    const f=await fixture(t,role,true);
    assert.deepEqual(f.registrations.map(r=>`${r.method} ${r.route}`).sort(),policy.map(([m,p])=>`${m} ${p}`).sort());
    assert.deepEqual(plain(vm.runInContext("publicAdminUser().permissions",f.ctx)),permissions);
    for(const [method,route,required] of policy){
      const url=route.replaceAll(":id","1").replace(":kind","ticket").replace(":attachmentId","1");
      const allowed=!required.length||permissions.includes("*")||required.some(p=>permissions.includes(p));
      for(const verb of method==="get"?["get","head"]:[method]){
        const r=await f.request(verb,url);assert.equal(r.status,allowed?200:403,`${verb} ${route} ${role}`);
        if(!allowed&&verb!=="head")assert.deepEqual(r.json,{detail:"Forbidden"});
      }
    }
    for(const route of ["artists","songs"]){
      const r=await f.request("delete",`/admin-api/${route}/1?confirm=DELETE%20FOREVER`);
      assert.equal(r.status,role==="super_admin"?200:403);
    }
  });
}

test("every protected route rejects missing/invalid credentials and forged role/cookie headers",async t=>{
  const f=await fixture(t,"super_admin",true);
  for(const [method,route] of policy.filter(([,p])=>p!=="/admin-api/login")){
    const url=route.replaceAll(":id","1").replace(":kind","ticket").replace(":attachmentId","1");
    for(const token of [null,"invalid-fixture-token"]){
      const r=await f.request(method,url,undefined,token,{"X-Admin-Role":"super_admin",Cookie:"tesohub_audio_preview=fixture-not-valid"});
      assert.equal(r.status,403,`${method} ${route}`);assert.deepEqual(r.json,{detail:"Forbidden"});
    }
  }
  assert.equal(f.calls.length,0,"Authentication must run before uploads or handlers");
});

test("lower roles cannot execute high-risk handlers or obtain even redacted exports",async t=>{
  for(const role of ["support_admin","moderator","content_admin"]){
    const f=await fixture(t,role);
    for(const [method,url,body] of [
      ["get","/admin-api/persistence-export"],
      ["get","/admin-api/persistence-export?include_sensitive=true&confirm=EXPORT%20RAW%20HASHES"],
      ["get","/admin-api/supabase-migration/jobs"], ["get","/admin-api/supabase-migration/jobs/1"],
      ...Object.entries(confirmations).map(([kind,confirm])=>["post",`/admin-api/supabase-migration/${kind}`,{confirm,role:"super_admin"}]),
      ["get","/admin-api/audit-log"], ["get","/admin-api/platform-health"],
      ["get","/admin-api/platform-settings"], ["put","/admin-api/platform-settings",{maintenance_mode:true}],
      ["get","/admin-api/feature-flags"], ["put","/admin-api/feature-flags",{sharing_enabled:false}],
      ["post","/admin-api/users/1/revoke-sessions"],
      ["delete","/admin-api/artists/1?confirm=DELETE%20FOREVER"], ["delete","/admin-api/songs/1?confirm=DELETE%20FOREVER"],
    ]){
      const r=await f.request(method,url,body);assert.equal(r.status,403,`${role} ${url}`);assert.deepEqual(r.json,{detail:"Forbidden"});
    }
    assert.equal(f.calls.length,0,"No DB, migration, upload, or audit side effect on denial");
  }
});

test("Super Admin high-risk workflows remain gated by confirmation and work with isolated stubs",async t=>{
  const f=await fixture(t,"super_admin");
  const safe=await f.request("get","/admin-api/persistence-export");
  assert.equal(safe.status,200);assert.equal(safe.json.includes_sensitive_hashes,false);
  assert.equal(safe.json.db.listeners[0].password_hash,"[redacted]");
  const sensitive=await f.request("get","/admin-api/persistence-export?include_sensitive=true&confirm=EXPORT%20RAW%20HASHES");
  assert.equal(sensitive.status,200);assert.equal(sensitive.json.db.listeners[0].password_hash,"fixture-password-hash");
  for(const [kind,confirm] of Object.entries(confirmations)){
    assert.equal((await f.request("post",`/admin-api/supabase-migration/${kind}`,{})).status,400);
    assert.equal((await f.request("post",`/admin-api/supabase-migration/${kind}`,{confirm})).status,202);
  }
  assert.equal(f.calls.filter(c=>c==="migration").length,3);
  assert.equal((await f.request("get","/admin-api/supabase-migration/jobs")).status,200);
  assert.equal((await f.request("get","/admin-api/platform-health")).status,200);
  assert.equal((await f.request("get","/admin-api/audit-log")).status,200);
  assert.equal((await f.request("put","/admin-api/platform-settings",{maintenance_mode:true})).status,200);
  assert.equal((await f.request("put","/admin-api/feature-flags",{sharing_enabled:false})).status,200);
  assert.equal((await f.request("post","/admin-api/users/1/revoke-sessions")).json.revoked,1);
  assert.equal((await f.request("delete","/admin-api/songs/1?confirm=DELETE%20FOREVER")).json.permanent,true);
  assert.equal((await f.request("delete","/admin-api/artists/1?confirm=DELETE%20FOREVER")).json.permanent,true);
  assert.ok(!f.calls.includes("error"));
});

test("Support retains ticket context, replies, notes, updates and attachments, but no account controls",async t=>{
  const f=await fixture(t,"support_admin");
  assert.equal((await f.request("get","/admin-api/support/tickets")).json[0].user.name,"Fixture listener");
  assert.equal((await f.request("get","/admin-api/support/tickets/1")).status,200);
  assert.equal((await f.request("post","/admin-api/support/tickets/1/replies",{message:"Fixture reply"})).status,201);
  assert.equal((await f.request("post","/admin-api/support/tickets/1/notes",{note:"Fixture internal note"})).status,201);
  assert.equal((await f.request("patch","/admin-api/support/tickets/1",{status:"resolved"})).json.status,"resolved");
  assert.equal((await f.request("get","/admin-api/support/tickets/1/attachments/ticket/1")).text,"synthetic fixture");
  assert.equal(f.ticket.messages.length,1);assert.equal(f.ticket.internal_notes.length,1);
  const before=f.calls.length;
  for(const [method,url] of [["get","/admin-api/users"],["post","/admin-api/users/1/suspend"],["post","/admin-api/users/1/restore"],["post","/admin-api/users/1/revoke-sessions"],["get","/admin-api/dashboard"]]){
    assert.equal((await f.request(method,url,{reason:"Not authorized"})).status,403);
  }
  assert.equal(f.calls.length,before);
});

test("Moderator genre dependency is a minimal active lookup, never genre management",async t=>{
  const f=await fixture(t,"moderator");
  assert.deepEqual((await f.request("get","/admin-api/genres")).json,[{id:1,name:"Gospel",active:true}]);
  for(const [method,url] of [["post","/admin-api/genres"],["put","/admin-api/genres/1"],["post","/admin-api/genres/1/activate"],["post","/admin-api/genres/1/deactivate"]]){
    const before=f.calls.length;assert.equal((await f.request(method,url,{name:"Blocked"})).status,403);assert.equal(f.calls.length,before);
  }
  for(const url of ["/admin-api/artists","/admin-api/songs"])assert.equal((await f.request("get",url)).status,200);
  assert.equal((await f.request("post","/admin-api/users/1/suspend",{reason:"Moderation"})).json.status,"suspended");
  assert.equal((await f.request("post","/admin-api/users/1/restore")).json.status,"active");
  assert.equal((await f.request("post","/admin-api/songs/1/hide")).json.status,"hidden");
  assert.equal((await f.request("delete","/admin-api/songs/1")).json.removed,true);
  assert.ok(!f.calls.includes("error"));
});

test("Moderator cannot bypass Discovery via create/edit; ordinary edits preserve existing Featured flags",async t=>{
  const f=await fixture(t,"moderator");
  for(const type of ["artists","songs"]){
    const before=f.calls.filter(c=>c==="save").length;
    assert.equal((await f.request("post",`/admin-api/${type}`,{is_featured:true})).status,403);
    assert.equal((await f.request("put",`/admin-api/${type}/1`,{is_featured:false})).status,403);
    assert.equal(f.calls.filter(c=>c==="save").length,before);
    const r=await f.request("put",`/admin-api/${type}/1`,{name:"Edited",title:"Edited"});
    assert.equal(r.status,200);assert.equal(r.json.is_featured,true);
    assert.equal((await f.request("put",`/admin-api/${type}/1`,{is_featured:true})).status,200);
    assert.equal((await f.request("post",`/admin-api/${type}`,{name:"New",title:"New",artist:1})).status,201);
  }
});

test("Content staff retain release review, catalog and discovery actions",async t=>{
  const f=await fixture(t,"content_admin");
  assert.equal((await f.request("get","/admin-api/releases")).status,200);
  assert.equal((await f.request("post","/admin-api/releases/1/approve",{})).json.status,"scheduled");
  assert.equal((await f.request("post","/admin-api/releases/1/reject",{reason:"Fixture review"})).json.status,"rejected");
  f.db.releases[0].status="under_review";
  assert.equal((await f.request("post","/admin-api/releases/1/request-changes",{reason:"Fixture changes"})).json.status,"rejected");
  assert.equal((await f.request("post","/admin-api/songs",{title:"Fixture new",artist:1,is_featured:true})).status,201);
  assert.equal((await f.request("put","/admin-api/songs/1",{title:"Fixture edit",is_featured:false})).json.is_featured,false);
  assert.equal((await f.request("post","/admin-api/songs/1/feature")).json.is_featured,true);
  assert.equal((await f.request("post","/admin-api/artists/1/unfeature")).json.is_featured,false);
  assert.equal((await f.request("get","/admin-api/genres")).json.length,2);
  assert.equal((await f.request("post","/admin-api/genres",{name:"Fixture genre"})).status,201);
  assert.ok(!f.calls.includes("error"));
});

test("dashboard is read-only and cannot publish releases as a side effect",async t=>{
  const f=await fixture(t,"moderator");
  assert.equal((await f.request("get","/admin-api/dashboard")).status,200);
  assert.deepEqual(f.calls,["load"]);
});
