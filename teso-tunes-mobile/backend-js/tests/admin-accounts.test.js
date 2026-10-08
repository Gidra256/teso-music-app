import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import express from "express";
import pg from "pg";
import {createAdminAccounts,adminPasswordHash,verifyAdminPassword} from "../adminAccounts.js";
import {canReadAudio,AUDIO_COOKIE,AUDIO_COOKIE_SECONDS,makeAudioCookie,validAudioCookie} from "../audioAccess.js";

const source=fs.readFileSync(new URL("../server.js",import.meta.url),"utf8").replace(/\r\n/g,"\n");
const extract=name=>{const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf("\n}",start)+2);};
const roleStart=source.indexOf("const ADMIN_ROLES ="), roleEnd=source.indexOf("};",source.indexOf("const ADMIN_ROLE_PERMISSIONS ="))+2;
const roles=vm.runInNewContext(source.slice(roleStart,roleEnd)+"; ADMIN_ROLE_PERMISSIONS");
const password="Fixture passphrase 2026!";
const recoveryToken="fixture-recovery-token-not-production";
const recoveryPassword="Fixture recovery phrase only!";
const digest=value=>crypto.createHash("sha256").update(value).digest("hex");

test("Admin password KDF is salted, strong, bounded and not plaintext",async()=>{
  const a=await adminPasswordHash(password),b=await adminPasswordHash(password);
  assert.notEqual(a,b);assert.match(a,/^scrypt\$32768\$8\$3\$/);assert.ok(!a.includes(password));
  assert.equal(await verifyAdminPassword(password,a),true);assert.equal(await verifyAdminPassword("incorrect",a),false);
  assert.equal(await verifyAdminPassword(password,"corrupt"),false);
  for(const p of ["", "short", " ".repeat(20),"x".repeat(20),"passwordpassword","x".repeat(129)])await assert.rejects(()=>adminPasswordHash(p));
});

test("guests and explicit bearer recovery do not require the staff database",async()=>{
  const service=createAdminAccounts({getPool:()=>{throw Error("Database unavailable");},roles,breakGlass:{token:recoveryToken,role:()=>"super_admin"}});
  const res={set(){},status(){throw Error("Unexpected database dependency");}};
  const guest={method:"GET",get:()=>""};await service.audioMiddleware(guest,res,()=>{});assert.equal(guest.adminIdentity,null);
  const recovery={method:"GET",get:key=>key==="authorization"?`Bearer ${recoveryToken}`:""};
  await service.middleware(recovery,res,()=>{});assert.equal(recovery.adminIdentity.auth_type,"break_glass");
});

test("individual Admin authentication, security and transactions",{skip:!process.env.TESO_P0C_POSTGRES_PORT,timeout:180000},async t=>{
  const config={host:"127.0.0.1",port:Number(process.env.TESO_P0C_POSTGRES_PORT),user:"p0c_fixture",password:"",ssl:false};
  assert.ok(config.port>=1024&&config.port<=65535);
  const database=`admin_accounts_${process.pid}_${Date.now()}`;
  const control=new pg.Client({...config,database:"postgres"});await control.connect();await control.query(`create database ${database}`);
  const pool=new pg.Pool({...config,database,max:6});
  const createdRoles=[];
  const publicProbe=`fixture_public_${process.pid}`, backendOwner=`fixture_owner_${process.pid}`, aclBridge=`fixture_acl_${process.pid}`;
  t.after(async()=>{await pool.end();await control.query(`drop database ${database}`);for(const role of createdRoles)await control.query(`drop role ${role}`);await control.end();});
  for(const role of ["anon","authenticated","service_role",publicProbe,backendOwner,aclBridge]){
    if(!(await control.query("select 1 from pg_roles where rolname=$1",[role])).rowCount){await control.query(`create role ${role} nologin ${role==="service_role"?"bypassrls":"nobypassrls"}`);createdRoles.push(role);}
  }
  await pool.query("create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[])");
  for(const file of ["001_supabase_initial.sql","004_support_v1.sql","005_support_identity_defaults.sql"])await pool.query(fs.readFileSync(new URL(`../migrations/${file}`,import.meta.url),"utf8"));
  // Simulate permissive Supabase defaults so migration revokes are really exercised.
  await pool.query(`grant usage on schema tesohub_music to public;
    alter default privileges grant all on tables to public,anon,authenticated,service_role;
    alter default privileges grant all on sequences to public,anon,authenticated,service_role;
    alter default privileges in schema tesohub_music grant all on tables to public,anon,authenticated,service_role;
    alter default privileges in schema tesohub_music grant all on sequences to public,anon,authenticated,service_role`);
  const migration=fs.readFileSync(new URL("../migrations/006_individual_admin_accounts.sql",import.meta.url),"utf8");
  let recoveryRole="super_admin";
  const service=createAdminAccounts({getPool:()=>pool,roles,breakGlass:{username:"fixture-recovery",password:recoveryPassword,token:recoveryToken,role:()=>recoveryRole}});
  const app=express();app.set("trust proxy",true);app.use(express.json());app.use("/admin-api",service.middleware);app.use("/api",service.audioMiddleware);
  const ctx=vm.createContext({AUDIO_COOKIE,AUDIO_COOKIE_SECONDS,makeAudioCookie,validAudioCookie,ADMIN_TOKEN:recoveryToken,adminAccounts:service,
    getBearerToken:req=>(req.get("authorization")||"").replace(/^Bearer\s+/i,"").trim(),hashToken:digest});
  vm.runInContext(source.slice(roleStart,roleEnd)+extract("adminCan")+extract("requireAdminPermission")+extract("audioAccessFor")+`async ${extract("setAudioPreviewCookie")}`,ctx);
  const requireAdmin=ctx.requireAdminPermission(), requireSuper=ctx.requireAdminPermission("*");
  service.install(app,requireAdmin,requireSuper);
  app.get("/admin-api/me",requireAdmin,async(req,res,next)=>{try{await ctx.setAudioPreviewCookie(req,res);res.json({admin:req.adminUser});}catch(e){next(e);}});
  app.delete("/admin-api/audio-preview-session",requireAdmin,async(req,res)=>{await service.revokePreview(req,res);res.sendStatus(204);});
  for(const permission of ["releases","catalog","support:view","applications","users","*"]){
    app.get(`/admin-api/check/${encodeURIComponent(permission)}`,ctx.requireAdminPermission(permission),(req,res)=>res.json({admin:req.adminUser}));
  }
  app.get("/api/releases/1/audio/",(req,res)=>res.sendStatus(canReadAudio({kind:"release",status:"under_review",is_public:false},ctx.audioAccessFor(req).reviewer)?200:404));
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");
  app.get("/admin/",(req,res)=>res.type("html").send(fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8")));
  app.use("/app-assets",express.static(fileURLToPath(new URL("../../mobile/assets",import.meta.url))));
  app.get("/admin-api/dashboard",requireAdmin,(req,res)=>res.json({}));
  app.get("/admin-api/platform-health",requireSuper,(req,res)=>res.json({backend_status:"ok",database:{}}));
  app.get("/admin-api/support/tickets",ctx.requireAdminPermission("support:view"),(req,res)=>res.json([]));
  t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(method,url,body={},auth={},headers={}){
    // node:http preserves Host for the proxy simulation; fetch rewrites it locally.
    const response=await new Promise((resolve,reject)=>{
      const req=http.request(base+url,{method,headers:{"Content-Type":"application/json","X-Teso-Admin":"1",...(auth.cookie?{Cookie:auth.cookie}:{}),...(auth.bearer?{Authorization:`Bearer ${auth.bearer}`} : {}),...headers}},resolve);
      req.on("error",reject);req.end(!["GET","HEAD"].includes(method)?JSON.stringify(body):undefined);
    });
    const chunks=[];for await(const chunk of response)chunks.push(chunk);
    const text=Buffer.concat(chunks).toString();let data;try{data=JSON.parse(text);}catch{}
    return {status:response.statusCode,data,text,cookies:response.headers["set-cookie"]||[]};
  }
  const recovery={bearer:recoveryToken};
  const newBody=(login="owner",role="super_admin")=>({display_name:"Fixture "+login,login_identifier:login,role,password});
  const login=async(username="owner",pass=password)=>{
    const r=await request("POST","/admin-api/login",{username,password:pass});
    assert.equal(r.status,200,r.text);return {cookie:r.cookies.find(x=>x.startsWith("tesohub_admin_session=")).split(";")[0],response:r};
  };
  await t.test("recovery me works before migration without querying missing staff tables",async()=>{
    assert.equal((await pool.query("select to_regclass('tesohub_music.admin_accounts') value")).rows[0].value,null);
    const r=await request("GET","/admin-api/me",{},recovery,{"X-Forwarded-Proto":"https"});
    assert.equal(r.status,200);assert.equal(r.data.admin.auth_type,"break_glass");assert.equal(r.data.admin.role,"super_admin");
    assert.match(r.cookies[0],/; Secure/);assert.doesNotMatch(r.text,/token_hash|password_hash/);
    // A new browser recovery session needs migration; it must fail closed, not mint an untracked cookie.
    const browser=await request("POST","/admin-api/break-glass-login",{username:"fixture-recovery",password:recoveryPassword});
    assert.equal(browser.status,503);assert.deepEqual(browser.cookies,[]);
  });
  await pool.query(migration);
  let owner;
  async function reset(){recoveryRole="super_admin";await pool.query("truncate tesohub_music.admin_sessions,tesohub_music.admin_accounts,tesohub_music.admin_login_limits,tesohub_music.admin_audit_logs restart identity cascade");
    assert.equal((await request("POST","/admin-api/admin-accounts/bootstrap",newBody(),recovery)).status,201);owner=await login();}
  async function check(name,fn){await t.test(name,async()=>{await reset();await fn();});}

  await check("migration duplicate fails atomically without changing existing staff, sessions or music tables",async()=>{
    const snapshot=async()=>JSON.stringify((await pool.query("select (select jsonb_agg(a) from tesohub_music.admin_accounts a) accounts,(select jsonb_agg(s) from tesohub_music.admin_sessions s) sessions,(select jsonb_agg(l) from tesohub_music.admin_audit_logs l) audit")).rows);
    const before=await snapshot();const client=await pool.connect();
    try{await assert.rejects(()=>client.query(migration),{code:"42P07"});await client.query("rollback");}finally{client.release();}
    assert.equal(await snapshot(),before);
    assert.doesNotMatch(migration,/\b(update|delete|truncate|drop)\s+(?:table\s+)?tesohub_music\.(?:listeners|songs|artists|releases)\b/i);
  });
  await check("migration halfway failure leaves no partial staff schema",async()=>{
    await pool.query("create schema fixture_partial");
    const broken=migration.replaceAll("tesohub_music.","fixture_partial.").replace("create index admin_sessions_expiry", "select fixture_missing_function(); create index admin_sessions_expiry");
    const client=await pool.connect();
    try{await assert.rejects(()=>client.query(broken),{code:"42883"});await client.query("rollback");}finally{client.release();}
    assert.equal((await pool.query("select count(*)::int n from pg_tables where schemaname='fixture_partial'")).rows[0].n,0);
  });
  await check("Admin tables and identity sequence deny public roles despite permissive default grants",async()=>{
    for(const role of ["anon","authenticated","service_role",publicProbe]){
      const client=await pool.connect();
      try{
        await client.query(`set role ${role}`);
        for(const table of ["admin_accounts","admin_sessions","admin_login_limits"]){
          for(const privilege of ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"]){
            assert.equal((await client.query("select has_table_privilege(current_user,$1,$2) allowed",[`tesohub_music.${table}`,privilege])).rows[0].allowed,false,`${role}/${table}/${privilege}`);
          }
          await assert.rejects(()=>client.query(`select * from tesohub_music.${table}`),{code:"42501"});
          await assert.rejects(()=>client.query(`delete from tesohub_music.${table}`),{code:"42501"});
        }
        for(const privilege of ["USAGE","SELECT","UPDATE"]){
          assert.equal((await client.query("select has_sequence_privilege(current_user,'tesohub_music.admin_accounts_id_seq',$1) allowed",[privilege])).rows[0].allowed,false,`${role}/sequence/${privilege}`);
        }
        await assert.rejects(()=>client.query("select nextval('tesohub_music.admin_accounts_id_seq')"),{code:"42501"});
      }finally{await client.query("reset role");client.release();}
    }
    assert.equal((await pool.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(c.relacl) a where n.nspname='tesohub_music'
      and c.relname in ('admin_accounts','admin_sessions','admin_login_limits','admin_accounts_id_seq') and a.grantee=0`)).rows[0].n,0);
    const indexes=(await pool.query("select indexname from pg_indexes where schemaname='tesohub_music' and tablename in ('admin_accounts','admin_sessions','admin_login_limits')")).rows;
    assert.equal(indexes.length,9);
    await assert.rejects(()=>pool.query("insert into tesohub_music.admin_sessions(token_hash,admin_id,expires_at) values($1,9999,now()+interval '1 hour')",[digest("orphan")]),{code:"23503"});
  });
  await check("restrictive RLS denies all client row access even after accidental grants and permissive policies",async()=>{
    const tables=["admin_accounts","admin_sessions","admin_login_limits"];
    const policies=(await pool.query("select tablename,permissive,roles::text[] as roles,cmd,qual,with_check from pg_policies where schemaname='tesohub_music' and tablename=any($1)",[tables])).rows;
    assert.equal(policies.length,3);
    for(const policy of policies){assert.equal(policy.permissive,"RESTRICTIVE");assert.deepEqual(policy.roles,["public"]);assert.equal(policy.cmd,"ALL");assert.equal(policy.qual,"false");assert.equal(policy.with_check,"false");}
    const client=await pool.connect();
    try{
      await client.query("begin");
      for(const table of tables){
        await client.query(`grant select,insert,update,delete on tesohub_music.${table} to public`);
        await client.query(`create policy fixture_accidental_allow on tesohub_music.${table} for all to public using(true) with check(true)`);
      }
      for(const role of ["anon","authenticated",publicProbe]){
        await client.query(`set local role ${role}`);
        for(const table of tables){
          assert.equal((await client.query(`select * from tesohub_music.${table}`)).rowCount,0);
          const column=table==="admin_accounts"?"display_name":table==="admin_sessions"?"expires_at":"attempts";
          assert.equal((await client.query(`update tesohub_music.${table} set ${column}=${column}`)).rowCount,0);
          assert.equal((await client.query(`delete from tesohub_music.${table}`)).rowCount,0);
        }
        for(const sql of [
          "insert into tesohub_music.admin_accounts(id,display_name,login_identifier,password_hash,role) overriding system value values(900,'Fixture','rls-fixture','scrypt$fixture','support_admin')",
          `insert into tesohub_music.admin_sessions(token_hash,admin_id,expires_at) values('${digest("fixture-rls")}',1,now()+interval '1 hour')`,
          "insert into tesohub_music.admin_login_limits(key_hash,attempts) values('fixture-rls',1)"
        ]){
          await client.query("savepoint denied_insert");
          await assert.rejects(()=>client.query(sql),error=>error.code==="42501"&&/row-level security/.test(error.message));
          await client.query("rollback to savepoint denied_insert");
        }
        await client.query("reset role");
      }
    }finally{await client.query("rollback");await client.query("reset role");client.release();}
    assert.equal((await request("GET","/admin-api/me",{},owner)).status,200);
  });
  await check("non-superuser database owner retains scoped staff CRUD and sequence access",async()=>{
    const schema="fixture_owner_schema";
    await pool.query(`create schema ${schema} authorization ${backendOwner}`);
    await pool.query(`alter default privileges for role ${backendOwner} in schema ${schema} grant all on tables to public,anon,authenticated,service_role;
      alter default privileges for role ${backendOwner} in schema ${schema} grant all on sequences to public,anon,authenticated,service_role`);
    const client=await pool.connect();
    try{
      await client.query(`set role ${backendOwner}`);
      const flags=(await client.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
      assert.deepEqual(flags,{rolsuper:false,rolbypassrls:false});
      await client.query(migration.replaceAll("tesohub_music",schema));
      await client.query("begin");
      const id=(await client.query(`insert into ${schema}.admin_accounts(display_name,login_identifier,password_hash,role) values('Fixture owner','owner','scrypt$fixture','super_admin') returning id`)).rows[0].id;
      await client.query(`insert into ${schema}.admin_sessions(token_hash,admin_id,expires_at) values($1,$2,now()+interval '1 hour')`,[digest("owner-session"),id]);
      await client.query(`insert into ${schema}.admin_login_limits(key_hash,attempts) values('fixture',1)`);
      assert.equal((await client.query(`select a.id from ${schema}.admin_accounts a join ${schema}.admin_sessions s on s.admin_id=a.id`)).rowCount,1);
      assert.equal((await client.query(`update ${schema}.admin_accounts set display_name='Updated fixture' where id=$1`,[id])).rowCount,1);
      assert.equal((await client.query(`delete from ${schema}.admin_sessions`)).rowCount,1);
      assert.equal((await client.query(`delete from ${schema}.admin_accounts`)).rowCount,1);
      assert.equal((await client.query(`delete from ${schema}.admin_login_limits`)).rowCount,1);
      await client.query("commit");
    }finally{await client.query("rollback");await client.query("reset role");client.release();}
  });
  await check("failure in ACL revocation rolls back all new tables, policies and sequences",async()=>{
    const schema="fixture_security_failure";
    await pool.query(`create schema ${schema}`);
    const broken=migration.replaceAll("tesohub_music",schema).replace(`revoke all on sequence ${schema}.admin_accounts_id_seq from public;`,`revoke all on sequence ${schema}.admin_accounts_id_seq from fixture_nonexistent_api_role;`);
    const client=await pool.connect();
    try{await assert.rejects(()=>client.query(broken),{code:"42704"});await client.query("rollback");}finally{client.release();}
    assert.equal((await pool.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1",[schema])).rows[0].n,0);
    assert.equal((await pool.query("select count(*)::int n from pg_policies where schemaname=$1",[schema])).rows[0].n,0);
  });
  await check("inherited ACL access aborts migration rather than leaving privileged client objects",async()=>{
    const schema="fixture_inherited_acl";
    await pool.query(`create schema ${schema}; grant ${aclBridge} to anon;
      alter default privileges in schema ${schema} grant select on tables to ${aclBridge}`);
    const client=await pool.connect();
    try{
      await assert.rejects(()=>client.query(migration.replaceAll("tesohub_music",schema)),error=>error.code==="P0001"&&/retains Admin object privileges/.test(error.message));
      await client.query("rollback");
    }finally{await client.query("rollback");client.release();await pool.query(`revoke ${aclBridge} from anon`);}
    assert.equal((await pool.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1",[schema])).rows[0].n,0);
  });
  await check("migration refuses Supabase API roles as object owners before creating any object",async()=>{
    for(const role of ["anon","authenticated","service_role"]){
      const client=await pool.connect();
      try{
        await client.query(`set role ${role}`);
        await assert.rejects(()=>client.query(migration.replaceAll("tesohub_music","fixture_forbidden_owner")),error=>error.code==="P0001"&&/requires a trusted database owner/.test(error.message));
      }finally{await client.query("rollback");await client.query("reset role");client.release();}
    }
  });
  await check("pre-existing identity sequence stops migration without modifying its ACL or creating a suffixed sequence",async()=>{
    const schema="fixture_sequence_collision";
    await pool.query(`create schema ${schema}; create sequence ${schema}.admin_accounts_id_seq`);
    const before=(await pool.query("select relacl::text from pg_class where oid=$1::regclass",[`${schema}.admin_accounts_id_seq`])).rows[0].relacl;
    const client=await pool.connect();
    try{
      await assert.rejects(()=>client.query(migration.replaceAll("tesohub_music",schema)),error=>error.code==="P0001"&&/sequence name already exists/.test(error.message));
      await client.query("rollback");
    }finally{await client.query("rollback");client.release();}
    assert.equal((await pool.query("select relacl::text from pg_class where oid=$1::regclass",[`${schema}.admin_accounts_id_seq`])).rows[0].relacl,before);
    assert.equal((await pool.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1",[schema])).rows[0].n,1);
  });
  await check("HTTPS proxy headers preserve Secure cookies, origin checks, paths and exact lifetimes",async()=>{
    const headers={Host:"teso-music-app.onrender.com","X-Forwarded-Proto":"https",Origin:"https://teso-music-app.onrender.com","Sec-Fetch-Site":"same-origin"};
    const r=await request("POST","/admin-api/login",{username:"owner",password},{},headers);
    assert.equal(r.status,200);assert.match(r.cookies[0],/Path=\/admin-api;/);assert.match(r.cookies[0],/Max-Age=28800;/);
    for(const flag of [/; Secure/,/; HttpOnly/,/SameSite=Strict/])assert.match(r.cookies[0],flag);
    const auth={cookie:r.cookies[0].split(";")[0]};
    const me=await request("GET","/admin-api/me",{},auth,headers);
    assert.equal(me.status,200);assert.match(me.cookies[0],/Path=\/api\/;/);assert.match(me.cookies[0],/Max-Age=900;/);assert.match(me.cookies[0],/; Secure/);
    const legacy=await request("GET","/admin-api/me",{},recovery,headers);assert.match(legacy.cookies[0],/; Secure/);
    assert.equal((await request("POST","/admin-api/logout",{},auth,{...headers,Origin:"https://attacker.invalid"})).status,403);
    assert.equal((await request("POST","/admin-api/logout",{},auth,headers)).status,204);
  });
  await check("bootstrap requires explicit Super Admin role and serializes competing first owners",async()=>{
    await pool.query("truncate tesohub_music.admin_sessions,tesohub_music.admin_accounts restart identity cascade");
    for(const role of [undefined,null,"","SUPER_ADMIN","support_admin"]){
      assert.equal((await request("POST","/admin-api/admin-accounts/bootstrap",{...newBody(),role},recovery)).status,400);
    }
    const results=await Promise.all([request("POST","/admin-api/admin-accounts/bootstrap",newBody("first"),recovery),request("POST","/admin-api/admin-accounts/bootstrap",newBody("second"),recovery)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    assert.equal((await pool.query("select count(*)::int n from tesohub_music.admin_accounts")).rows[0].n,1);
  });
  await check("bootstrap audit failure rolls back owner insert and remains retryable",async()=>{
    await pool.query("truncate tesohub_music.admin_sessions,tesohub_music.admin_accounts restart identity cascade");
    await pool.query(`create function tesohub_music.fixture_admin_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture'; end $$;
      create trigger fixture_admin_audit_failure before insert on tesohub_music.admin_audit_logs for each row execute function tesohub_music.fixture_admin_audit_failure()`);
    try{
      const r=await request("POST","/admin-api/admin-accounts/bootstrap",newBody(),recovery);
      assert.equal(r.status,503);assert.doesNotMatch(r.text,/fixture|scrypt|password/i);
      assert.equal((await pool.query("select count(*)::int n from tesohub_music.admin_accounts")).rows[0].n,0);
    }finally{await pool.query("drop trigger fixture_admin_audit_failure on tesohub_music.admin_audit_logs; drop function tesohub_music.fixture_admin_audit_failure()");}
    assert.equal((await request("POST","/admin-api/admin-accounts/bootstrap",newBody(),recovery)).status,201);
  });
  await check("break-glass survives before owner, after owner and after all individual sessions revoked",async()=>{
    assert.equal((await request("GET","/admin-api/me",{},recovery)).status,200);
    await request("POST","/admin-api/admin-accounts/1/revoke-sessions",{},recovery);
    assert.equal((await request("GET","/admin-api/me",{},owner)).status,403);
    assert.equal((await request("GET","/admin-api/me",{},recovery)).status,200);
    assert.equal((await pool.query("select active,role from tesohub_music.admin_accounts where id=1")).rows[0].active,true);
    const audit=(await pool.query("select admin_user,details from tesohub_music.admin_audit_logs where action='admin_sessions_revoked'")).rows[0];
    assert.equal(audit.admin_user,"break-glass:environment");assert.equal(audit.details.auth_type,"break_glass");
    await pool.query("truncate tesohub_music.admin_sessions,tesohub_music.admin_accounts restart identity cascade");
    assert.equal((await request("GET","/admin-api/me",{},recovery)).status,200);
  });
  await check("second owner permits legitimate demotion without disabling remaining owner",async()=>{
    assert.equal((await request("POST","/admin-api/admin-accounts",newBody("second"),owner)).status,201);
    const second=await login("second");
    assert.equal((await request("PATCH","/admin-api/admin-accounts/1",{role:"content_admin"},second)).status,200);
    assert.equal((await request("GET","/admin-api/me",{},owner)).status,403);
    assert.equal((await request("GET","/admin-api/me",{},second)).data.admin.role,"super_admin");
  });
  await check("successful login resets only account failures; source budget still blocks credential spraying",async()=>{
    for(let i=0;i<3;i++)assert.equal((await request("POST","/admin-api/login",{username:"owner",password:"wrong"})).status,401);
    assert.equal((await pool.query("select attempts from tesohub_music.admin_login_limits where key_hash=$1",[digest("individual:login:owner")])).rows[0].attempts,3);
    await login();
    assert.equal((await pool.query("select 1 from tesohub_music.admin_login_limits where key_hash=$1",[digest("individual:login:owner")])).rowCount,0);
    const ipKey=digest("individual:ip:127.0.0.1");
    assert.equal((await pool.query("select attempts from tesohub_music.admin_login_limits where key_hash=$1",[ipKey])).rows[0].attempts,5);
    await pool.query("update tesohub_music.admin_login_limits set attempts=30 where key_hash=$1",[ipKey]);
    assert.equal((await request("POST","/admin-api/login",{username:"owner",password})).status,429);
  });
  await check("expired throttle windows recover, stale records clean up, individual lockout cannot block recovery",async()=>{
    const ipKey=digest("individual:ip:127.0.0.1");
    await pool.query("update tesohub_music.admin_login_limits set attempts=30 where key_hash=$1",[ipKey]);
    assert.equal((await request("POST","/admin-api/login",{username:"owner",password})).status,429);
    assert.equal((await request("POST","/admin-api/break-glass-login",{username:"fixture-recovery",password:recoveryPassword})).status,200);
    await pool.query("update tesohub_music.admin_login_limits set window_start=now()-interval '16 minutes'");
    await pool.query("insert into tesohub_music.admin_login_limits(key_hash,attempts,window_start) values('fixture-old',99,now()-interval '2 days')");
    await login();
    assert.equal((await pool.query("select 1 from tesohub_music.admin_login_limits where key_hash='fixture-old'")).rowCount,0);
    assert.equal((await pool.query("select attempts from tesohub_music.admin_login_limits where key_hash=$1",[ipKey])).rows[0].attempts,1);
    assert.equal((await request("GET","/admin-api/me",{},recovery)).status,200);
  });
  await check("throttle account keys span sources and untrusted leftmost forwarded address cannot evade source budget",async()=>{
    const input={username:"missing",password:"wrong"};
    for(let i=0;i<10;i++)assert.equal((await request("POST","/admin-api/login",input,{}, {"X-Forwarded-For":`spoof-${i}, 192.0.2.10`})).status,401);
    assert.equal((await request("POST","/admin-api/login",input,{}, {"X-Forwarded-For":"192.0.2.11"})).status,429);
    assert.equal((await pool.query("select attempts from tesohub_music.admin_login_limits where key_hash=$1",[digest("individual:ip:192.0.2.10")])).rows[0].attempts,10);
  });

  await check("login issues only Secure HttpOnly SameSite cookies; identity and list never expose credentials",async()=>{
    const r=owner.response;assert.ok(r.cookies.some(x=>/HttpOnly/.test(x)&&/Secure/.test(x)&&/SameSite=Strict/.test(x)&&/Max-Age=28800/.test(x)));
    assert.equal(r.data.token,undefined);assert.equal(r.data.admin.id,"1");assert.equal(r.data.admin.role,"super_admin");
    const list=await request("GET","/admin-api/admin-accounts",{},owner);assert.equal(list.status,200);assert.doesNotMatch(list.text,/password_hash|scrypt\$|token_hash|preview_hash/);
    assert.deepEqual(Object.keys(list.data[0]).sort(),["id","display_name","login_identifier","username","role","permissions","auth_type","active","created_at","updated_at","last_login_at"].sort());
    const stored=(await pool.query("select password_hash from tesohub_music.admin_accounts")).rows[0].password_hash;assert.notEqual(stored,password);
    const raw=owner.cookie.split("=")[1];assert.equal((await pool.query("select token_hash from tesohub_music.admin_sessions")).rows[0].token_hash,digest(raw));
  });
  await check("wrong password, unknown and disabled accounts denied with same generic response",async()=>{
    const wrong=await request("POST","/admin-api/login",{username:"owner",password:"wrong"});
    const unknown=await request("POST","/admin-api/login",{username:"unknown",password});
    await request("POST","/admin-api/admin-accounts",newBody("disabled","support_admin"),owner);
    await request("PATCH","/admin-api/admin-accounts/2",{active:false},owner);
    const disabled=await request("POST","/admin-api/login",{username:"disabled",password});
    for(const r of [wrong,unknown,disabled]){assert.equal(r.status,401);assert.equal(r.text,wrong.text);assert.equal(r.cookies.length,0);}
  });
  await check("logout invalidates copied session and private-preview capability",async()=>{
    const me=await request("GET","/admin-api/me",{},owner);const preview={cookie:me.cookies[0].split(";")[0]};
    assert.match(me.cookies[0],/Max-Age=900/);assert.match(me.cookies[0],/HttpOnly/);assert.match(me.cookies[0],/Secure/);
    assert.equal((await request("GET","/api/releases/1/audio/",{},preview)).status,200);
    assert.equal((await request("POST","/admin-api/logout",{},owner)).status,204);
    assert.equal((await request("GET","/admin-api/me",{},owner)).status,403);
    assert.equal((await request("GET","/api/releases/1/audio/",{},preview)).status,404);
  });
  await check("session expiry and preview expiry are enforced server-side",async()=>{
    const preview={cookie:(await request("GET","/admin-api/me",{},owner)).cookies[0].split(";")[0]};
    await pool.query("update tesohub_music.admin_sessions set preview_expires_at=now()-interval '1 minute'");
    assert.equal((await request("GET","/api/releases/1/audio/",{},preview)).status,404);
    await pool.query("update tesohub_music.admin_sessions set created_at=now()-interval '10 hours',expires_at=now()-interval '1 hour'");
    assert.equal((await request("GET","/admin-api/me",{},owner)).status,403);
  });
  for(const role of Object.keys(roles))await check(`individual ${role}: exact P0-B permissions; no forged promotion`,async()=>{
    const created=await request("POST","/admin-api/admin-accounts",newBody("staff",role),owner);assert.equal(created.status,201);
    const staff=await login("staff");
    const me=await request("GET","/admin-api/me",{},staff,{"X-Admin-Role":"super_admin"});
    assert.deepEqual(me.data.admin.permissions,[...roles[role]]);
    for(const permission of ["releases","catalog","support:view","applications","users","*"]){
      const expected=roles[role].includes("*")||roles[role].includes(permission);
      assert.equal((await request("GET",`/admin-api/check/${encodeURIComponent(permission)}`,{},staff)).status,expected?200:403);
    }
    if(role!=="super_admin")for(const [method,url,body] of [["POST","/admin-api/admin-accounts",newBody("forged")],["PATCH","/admin-api/admin-accounts/2",{role:"super_admin"}],["POST","/admin-api/admin-accounts/1/reset-password",{password}],["POST","/admin-api/admin-accounts/1/revoke-sessions",{}],["POST","/admin-api/admin-accounts/bootstrap",newBody()]])assert.equal((await request(method,url,body,staff)).status,403);
    const preview=me.cookies.length?{cookie:me.cookies[0].split(";")[0]}:{};
    assert.equal((await request("GET","/api/releases/1/audio/",{},preview)).status,["super_admin","content_admin"].includes(role)?200:404);
  });
  await check("role downgrade and disable revoke API/preview; reactivation permits fresh login only",async()=>{
    await request("POST","/admin-api/admin-accounts",newBody("staff","content_admin"),owner);let staff=await login("staff");
    const preview={cookie:(await request("GET","/admin-api/me",{},staff)).cookies[0].split(";")[0]};
    assert.equal((await request("PATCH","/admin-api/admin-accounts/2",{role:"support_admin"},owner)).status,200);
    assert.equal((await request("GET","/admin-api/me",{},staff)).status,403);assert.equal((await request("GET","/api/releases/1/audio/",{},preview)).status,404);
    staff=await login("staff");assert.equal((await request("GET","/admin-api/me",{},staff)).data.admin.role,"support_admin");
    await request("PATCH","/admin-api/admin-accounts/2",{active:false},owner);assert.equal((await request("GET","/admin-api/me",{},staff)).status,403);
    await request("PATCH","/admin-api/admin-accounts/2",{active:true},owner);assert.equal((await request("GET","/admin-api/me",{},staff)).status,403);await login("staff");
  });
  await check("duplicate and malformed logins/roles rejected; final owner cannot be disabled/demoted",async()=>{
    assert.equal((await request("POST","/admin-api/admin-accounts",newBody("OWNER"),owner)).status,409);
    assert.equal((await request("POST","/admin-api/admin-accounts",newBody("staff","SUPER_ADMIN"),owner)).status,400);
    for(const body of [{active:false},{role:"content_admin"}])assert.equal((await request("PATCH","/admin-api/admin-accounts/1",body,owner)).status,409);
  });
  await check("independent concurrent security requests cannot remove both active Super Admins",async()=>{
    await request("POST","/admin-api/admin-accounts",newBody("second"),owner);
    const result=await Promise.all([request("PATCH","/admin-api/admin-accounts/1",{active:false},recovery),request("PATCH","/admin-api/admin-accounts/2",{role:"moderator"},recovery)]);
    assert.deepEqual(result.map(x=>x.status).sort(),[200,409]);
    assert.equal((await pool.query("select count(*)::int n from tesohub_music.admin_accounts where active and role='super_admin'")).rows[0].n,1);
  });
  await check("own password change invalidates every session and rejects previous password",async()=>{
    const next="Another fixture passphrase!";
    const second=await login();
    assert.equal((await request("POST","/admin-api/change-password",{current_password:"bad",password:next},owner)).status,401);
    assert.equal((await request("POST","/admin-api/change-password",{current_password:password,password:next},owner)).status,200);
    for(const auth of [owner,second])assert.equal((await request("GET","/admin-api/me",{},auth)).status,403);
    assert.equal((await request("POST","/admin-api/login",{username:"owner",password})).status,401);await login("owner",next);
    assert.deepEqual((await pool.query("select active,role from tesohub_music.admin_accounts where id=1")).rows[0],{active:true,role:"super_admin"});
  });
  await check("Super Admin reset and explicit revoke invalidate sessions; passwords absent from audit",async()=>{
    await request("POST","/admin-api/admin-accounts",newBody("staff","content_admin"),owner);
    let staff=await login("staff");const next="Replacement fixture phrase!";
    assert.equal((await request("POST","/admin-api/admin-accounts/2/reset-password",{password:next},owner)).status,200);
    assert.equal((await request("GET","/admin-api/me",{},staff)).status,403);staff=await login("staff",next);
    assert.equal((await request("POST","/admin-api/admin-accounts/2/revoke-sessions",{},owner)).status,200);
    assert.equal((await request("GET","/admin-api/me",{},staff)).status,403);
    const audit=(await pool.query("select * from tesohub_music.admin_audit_logs order by id")).rows;
    assert.ok(audit.some(x=>x.admin_user==="break-glass:environment"&&x.action==="admin_bootstrap"));
    assert.ok(audit.some(x=>x.admin_user==="admin:1:owner"&&x.action==="admin_password_reset"));
    assert.ok(!JSON.stringify(audit).includes(next));assert.ok(!JSON.stringify(audit).includes(password));assert.doesNotMatch(JSON.stringify(audit),/scrypt\$/);
  });
  await check("bootstrap is authenticated break-glass only, single-use; recovery is explicitly Super Admin only",async()=>{
    assert.equal((await request("POST","/admin-api/admin-accounts/bootstrap",newBody("another"))).status,403);
    assert.equal((await request("POST","/admin-api/admin-accounts/bootstrap",newBody("another"),owner)).status,403);
    assert.equal((await request("POST","/admin-api/admin-accounts/bootstrap",newBody("another"),recovery)).status,409);
    assert.equal((await request("POST","/admin-api/admin-accounts",newBody("another"),recovery)).status,403);
    for(const invalid of [undefined,"","false","SUPER_ADMIN","content_admin","moderator","support_admin"]){recoveryRole=invalid;assert.equal((await request("GET","/admin-api/me",{},recovery)).status,403);}
  });
  await check("browser recovery uses revocable cookie, does not return environment token",async()=>{
    const r=await request("POST","/admin-api/break-glass-login",{username:"fixture-recovery",password:recoveryPassword});assert.equal(r.status,200);assert.equal(r.data.admin.auth_type,"break_glass");assert.ok(!r.text.includes(recoveryToken));
    const auth={cookie:r.cookies[0].split(";")[0]};assert.equal((await request("GET","/admin-api/me",{},auth)).status,200);
    await request("POST","/admin-api/logout",{},auth);assert.equal((await request("GET","/admin-api/me",{},auth)).status,403);
  });
  await check("CSRF: cross-site and missing custom header rejected, forged bearer cannot use cookie",async()=>{
    for(const headers of [{"Origin":"https://attacker.invalid"},{"Sec-Fetch-Site":"cross-site"},{"X-Teso-Admin":""}])assert.equal((await request("POST","/admin-api/admin-accounts",newBody("bad"),owner,headers)).status,403);
    assert.equal((await request("GET","/admin-api/me",{}, {...owner,bearer:"invalid"})).status,403);
  });
  await check("persistent throttling is shared across requests and login identifiers",async()=>{
    for(let i=0;i<10;i++)assert.equal((await request("POST","/admin-api/login",{username:"unknown",password:"wrong"})).status,401);
    assert.equal((await request("POST","/admin-api/login",{username:"unknown",password:"wrong"})).status,429);
    assert.equal((await pool.query("select count(*)::int n from tesohub_music.admin_accounts")).rows[0].n,1);
  });
  await check("sessions survive service recreation; live role lookup, stale protection and RLS stay authoritative",async()=>{
    const fresh=createAdminAccounts({getPool:()=>pool,roles,breakGlass:{username:"fixture-recovery",password:recoveryPassword,token:recoveryToken,role:()=>recoveryRole}});
    const req={method:"GET",get:key=>key==="cookie"?owner.cookie:""};
    await fresh.middleware(req,{set(){},status(){throw Error("Unexpected denial");}},()=>{});
    assert.equal(req.adminIdentity.id,"1");
    await request("POST","/admin-api/admin-accounts",newBody("staff","content_admin"),owner);const staff=await login("staff");
    await pool.query("update tesohub_music.admin_accounts set role='support_admin' where id=2");
    assert.equal((await request("GET","/admin-api/check/releases",{},staff)).status,403);
    assert.equal((await request("PATCH","/admin-api/admin-accounts/2",{role:"content_admin",expected_updated_at:"2000-01-01"},owner)).status,409);
    const secured=(await pool.query("select relrowsecurity from pg_class where oid in ('tesohub_music.admin_accounts'::regclass,'tesohub_music.admin_sessions'::regclass,'tesohub_music.admin_login_limits'::regclass)")).rows;
    assert.equal(secured.length,3);assert.ok(secured.every(row=>row.relrowsecurity));
  });
  await check("security transactions use their existing connection even with a one-connection pool",async()=>{
    await request("POST","/admin-api/admin-accounts",newBody("staff","content_admin"),owner);
    const singlePool=new pg.Pool({...config,database,max:1,connectionTimeoutMillis:2000});
    const single=createAdminAccounts({getPool:()=>singlePool,roles,breakGlass:{token:recoveryToken,role:()=>"super_admin"}});
    const small=express();small.use(express.json());small.use("/admin-api",single.middleware);single.install(small,requireAdmin,requireSuper);
    const server2=small.listen(0,"127.0.0.1");await once(server2,"listening");
    try {
      const results=await Promise.all(Array.from({length:5},()=>fetch(`http://127.0.0.1:${server2.address().port}/admin-api/admin-accounts/2`,{method:"PATCH",headers:{"Content-Type":"application/json","X-Teso-Admin":"1",Cookie:owner.cookie},body:JSON.stringify({role:"moderator"})})));
      assert.deepEqual(results.map(r=>r.status),[200,200,200,200,200]);
    } finally {await new Promise(resolve=>{server2.close(resolve);server2.closeAllConnections();});await singlePool.end();}
  });
  await t.test("real browser bootstrap, individual login, management, password change and responsive cookies",{skip:!process.env.TESO_PLAYWRIGHT_MODULE,timeout:90000},async()=>{
    await reset();
    await pool.query("truncate tesohub_music.admin_sessions,tesohub_music.admin_accounts,tesohub_music.admin_login_limits restart identity cascade");
    const {chromium}=await import(pathToFileURL(process.env.TESO_PLAYWRIGHT_MODULE).href);
    const browser=await chromium.launch({headless:true,channel:"chrome"});
    try {
      const context=await browser.newContext({viewport:{width:390,height:900}});
      await context.addInitScript(()=>localStorage.setItem("tesoAdminToken","obsolete-fixture-token"));
      const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];
      page.on("pageerror",error=>errors.push(error.message));page.on("dialog",dialog=>dialog.accept());
      await page.goto(base+"/admin/");
      const signIn=async(name,pass,recoveryLogin=false)=>{
        await page.locator("#loginUsername").fill(name);await page.locator("#loginPassword").fill(pass);
        await page.locator("#recoveryLogin").setChecked(recoveryLogin);
        await page.getByRole("button",{name:"Sign in",exact:true}).click();
        await page.locator("#adminPanel:not(.hidden)").waitFor();
        await page.locator("#nav button").first().waitFor();
      };
      await signIn("fixture-recovery",recoveryPassword,true);
      await page.getByRole("button",{name:"Admin Management",exact:true}).click();
      const bootstrap=page.locator('[data-admin-form="bootstrap"]');await bootstrap.waitFor();
      await bootstrap.locator('[name="display_name"]').fill("Browser Owner");await bootstrap.locator('[name="login_identifier"]').fill("browserowner");await bootstrap.locator('[name="password"]').fill(password);
      await bootstrap.getByRole("button").click();await page.getByRole("heading",{name:"Browser Owner"}).waitFor();assert.equal(await bootstrap.count(),0);
      await page.getByRole("button",{name:"Logout",exact:true}).click();
      await signIn("browserowner",password);
      await page.getByRole("button",{name:"Admin Management",exact:true}).click();
      const create=page.locator('[data-admin-form="create"]');await create.waitFor();
      await create.locator('[name="display_name"]').fill("Browser Support");await create.locator('[name="login_identifier"]').fill("browsersupport");await create.locator('[name="password"]').fill(password);
      await create.getByRole("button").evaluate(button=>{button.click();button.click();});
      await page.getByRole("heading",{name:"Browser Support",exact:true}).waitFor();
      assert.equal((await pool.query("select count(*)::int n from tesohub_music.admin_accounts")).rows[0].n,2);
      assert.equal(await page.evaluate(()=>localStorage.getItem("tesoAdminToken")),null);
      assert.doesNotMatch(await page.evaluate(()=>document.cookie),/tesohub_admin_session|tesohub_audio_preview/);
      const cookies=await context.cookies();assert.ok(cookies.some(c=>c.name==="tesohub_admin_session"&&c.httpOnly&&c.secure&&c.sameSite==="Strict"));
      const dir=path.join(os.tmpdir(),"tesohub-individual-admin-review");fs.mkdirSync(dir,{recursive:true});
      for(const width of [320,390,768,1440]){
        await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Admin overflow ${width}`);
        await page.getByRole("button",{name:"Add Admin",exact:true}).scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(dir,`admin-accounts-${width}.png`),fullPage:true});
      }
      const access=page.locator('[data-admin-form="access"][data-id="2"]');
      await access.locator('[name="role"]').selectOption("moderator");await access.getByRole("button").click();
      await page.waitForFunction(()=>document.querySelector('[data-admin-form="access"][data-id="2"] [name="role"]')?.value==="moderator");
      await page.getByRole("button",{name:"Account Security",exact:true}).click();
      await page.locator('[name="current_password"]').fill(password);const next="Browser changed passphrase!";
      await page.locator('[data-admin-form="password"] [name="password"]').fill(next);
      await page.getByRole("button",{name:"Change password",exact:true}).click();await page.locator("#loginPanel:not(.hidden)").waitFor();
      await signIn("browserowner",next);await page.getByRole("button",{name:"Logout",exact:true}).click();
      await signIn("browsersupport",password);
      assert.equal(await page.getByRole("button",{name:"Admin Management",exact:true}).count(),0);
      assert.deepEqual(errors,[]);
    } finally {await browser.close();}
  });
});
