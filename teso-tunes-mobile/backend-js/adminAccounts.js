import crypto from "node:crypto";
import { promisify } from "node:util";
import { validAudioCookie } from "./audioAccess.js";

const scrypt = promisify(crypto.scrypt);
const HASH_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
let activeKdfs = 0;
async function derive(password, salt) {
  if (activeKdfs >= 2) throw fail(429, "Login service is busy. Please retry shortly.");
  activeKdfs++;
  try { return await scrypt(password, salt, 64, HASH_OPTIONS); }
  finally { activeKdfs--; }
}
const SESSION = "tesohub_admin_session";
const PREVIEW = "tesohub_audio_preview";
const HOURS = 8;
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const opaque = () => crypto.randomBytes(32).toString("hex");
const fail = (status, message) => Object.assign(new Error(message), { status });
const safeEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const cookie = (req, name) => String(req.get("cookie") || "").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1) || "";
const cookieOptions = path => ({ httpOnly: true, secure: true, sameSite: "strict", path });

export async function adminPasswordHash(password) {
  if (typeof password !== "string" || password.length < 15 || password.length > 128 || password.trim().length < 15 || /^(.)\1+$/.test(password) || ["passwordpassword", "password123456789", "123456789012345"].includes(password.toLowerCase())) {
    throw fail(400, "Use a password or passphrase of 15 to 128 characters.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await derive(password, salt);
  return `scrypt$32768$8$3$${salt}$${derived.toString("hex")}`;
}

export async function verifyAdminPassword(password, stored) {
  const parts = String(stored || "").split("$");
  const valid = parts.length === 6 && parts.slice(0,4).join("$") === "scrypt$32768$8$3" && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  const derived = await derive(typeof password === "string" ? password.slice(0,128) : "", valid ? parts[4] : "00000000000000000000000000000000");
  return valid && typeof password === "string" && password.length <= 128 && crypto.timingSafeEqual(derived, Buffer.from(parts[5], "hex"));
}

// Dedicated scoped SQL only. These tables never enter the music snapshot/JSON path.
export function createAdminAccounts({ getPool, roles, breakGlass }) {
  const identity = row => row && Object.hasOwn(roles, row.role) ? {
    id: String(row.id), display_name: row.display_name, login_identifier: row.login_identifier,
    username: `admin:${row.id}:${row.login_identifier}`,
    role: row.role, permissions: roles[row.role], auth_type: "individual",
  } : null;
  const recovery = () => breakGlass.role() === "super_admin" ? {
    id: null, display_name: "Break-glass recovery", username: "break-glass:environment",
    role: "super_admin", permissions: roles.super_admin, auth_type: "break_glass",
  } : null;
  const publicRow = row => ({ ...identity(row), active: row.active, created_at: row.created_at, updated_at: row.updated_at, last_login_at: row.last_login_at });
  const actorName = actor => actor.auth_type === "break_glass" ? "break-glass:environment" : actor.auth_type === "login" ? "security:login" : actor.username;
  async function audit(client, actor, action, target = null, details = {}) {
    await client.query(`insert into tesohub_music.admin_audit_logs(admin_user,admin_role,action,target_type,target_id,details)
      values ($1,$2,$3,'admin_account',$4,$5)`, [actorName(actor), actor.role, action, target, JSON.stringify({ ...details, actor_admin_id: actor.id, auth_type: actor.auth_type })]);
  }
  async function transaction(fn) {
    const client = await getPool().connect();
    try { await client.query("begin"); const result = await fn(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  async function session(token, preview = false, client) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    client ||= getPool();
    const { rows } = await client.query(`select s.*, a.display_name,a.login_identifier,a.role,a.active
      from tesohub_music.admin_sessions s left join tesohub_music.admin_accounts a on a.id=s.admin_id
      where s.${preview ? "preview_hash" : "token_hash"}=$1 and s.expires_at>now()
      ${preview ? "and s.preview_expires_at>now()" : ""}`, [hash(token)]);
    const row = rows[0];
    if (!row) return null;
    const admin = row.break_glass ? (safeEqual(row.recovery_key_hash, hash(breakGlass.token)) ? recovery() : null)
      : row.active ? identity({ ...row, id: row.admin_id }) : null;
    return admin ? { admin, tokenHash: row.token_hash } : null;
  }
  async function resolve(req, preview = false, client) {
    const auth = req.get("authorization") || "";
    if (auth) {
      const match = /^Bearer ([^\s]+)$/i.exec(auth);
      return match && safeEqual(match[1], breakGlass.token) ? { admin: recovery(), tokenHash: null } : null;
    }
    if (req.get("sec-fetch-site") === "cross-site") return null;
    if (preview && validAudioCookie(cookie(req, PREVIEW), breakGlass.token)) return {admin:recovery(),tokenHash:null};
    return session(cookie(req, preview ? PREVIEW : SESSION), preview, client);
  }
  function sameOrigin(req) {
    if (req.get("sec-fetch-site") === "cross-site") return false;
    const origin = req.get("origin");
    return !origin || origin === `${req.protocol}://${req.get("host")}`;
  }
  async function middleware(req, res, next) {
    try {
      res.set("Cache-Control", "no-store");
      const auth = await resolve(req);
      req.adminIdentity = auth?.admin || null;
      req.adminSessionHash = auth?.tokenHash || null;
      if (!["GET","HEAD","OPTIONS"].includes(req.method) && (!sameOrigin(req) ||
          (!req.get("authorization") && req.get("x-teso-admin") !== "1"))) {
        return res.status(403).json({ detail: "Forbidden" });
      }
      next();
    } catch { res.status(503).json({detail:"Admin authentication is temporarily unavailable."}); }
  }
  async function audioMiddleware(req, res, next) {
    try { req.adminIdentity = (await resolve(req, true))?.admin || null; next(); }
    catch { res.status(503).json({detail:"Media authorization is temporarily unavailable."}); }
  }
  async function preview(req, res) {
    const admin = req.adminIdentity;
    if (!admin || !["*","releases","catalog"].some(p=>admin.permissions.includes(p))) return;
    // Legacy bearer recovery uses its existing short-lived cookie. Browser sessions
    // use a random preview capability linked to the revocable parent session.
    if (!req.adminSessionHash) return;
    const token = opaque();
    await getPool().query(`update tesohub_music.admin_sessions set preview_hash=$1,preview_expires_at=least(expires_at,now()+interval '15 minutes') where token_hash=$2`, [hash(token),req.adminSessionHash]);
    res.cookie(PREVIEW, token, { ...cookieOptions("/api/"), maxAge: 900000 });
  }
  async function revokePreview(req, res) {
    if (req.adminSessionHash) await getPool().query("update tesohub_music.admin_sessions set preview_hash=null,preview_expires_at=null where token_hash=$1", [req.adminSessionHash]);
    res.clearCookie(PREVIEW, cookieOptions("/api/"));
  }
  async function throttle(req, login, isRecovery) {
    // Render's rightmost forwarded address is the nearest trusted hop; do not trust
    // a client-supplied leftmost X-Forwarded-For value (global trust proxy is legacy).
    const ip = String(req.get("x-forwarded-for") || req.socket.remoteAddress || "").split(",").at(-1).trim();
    const realm = isRecovery ? "recovery" : "individual";
    const accountKey = hash(`${realm}:login:${login}`);
    await getPool().query("delete from tesohub_music.admin_login_limits where window_start<now()-interval '1 day'");
    for (const [key, limit] of [[hash(`${realm}:ip:${ip}`),30],[accountKey,10]]) {
      const { rows } = await getPool().query(`insert into tesohub_music.admin_login_limits(key_hash,attempts) values($1,1)
        on conflict(key_hash) do update set attempts=case when admin_login_limits.window_start<now()-interval '15 minutes' then 1 else admin_login_limits.attempts+1 end,
        window_start=case when admin_login_limits.window_start<now()-interval '15 minutes' then now() else admin_login_limits.window_start end returning attempts`,[key]);
      if (rows[0].attempts > limit) throw fail(429,"Too many attempts. Try again in 15 minutes.");
    }
    return accountKey;
  }
  async function login(req, res, isRecovery = false) {
    const login = String(req.body?.username || "").trim().toLowerCase().slice(0,120);
    const accountKey = await throttle(req, login, isRecovery);
    let row, admin, expectedHash;
    if (isRecovery) {
      const valid = breakGlass.password && safeEqual(req.body?.username || "", breakGlass.username) && safeEqual(req.body?.password || "", breakGlass.password);
      // Pay the same KDF cost even for recovery/unknown accounts.
      await verifyAdminPassword(req.body?.password, "");
      admin = valid ? recovery() : null;
    } else {
      row = (await getPool().query("select * from tesohub_music.admin_accounts where login_identifier=$1",[login])).rows[0];
      expectedHash = row?.password_hash;
      const valid = await verifyAdminPassword(req.body?.password, expectedHash);
      admin = valid && row?.active ? identity(row) : null;
    }
    if (!admin) {
      await audit(getPool(), {id:null,username:"login",role:"system",auth_type:"login"}, "admin_login_denied", null, {identifier_hash:hash(login)});
      throw fail(401,"Invalid admin login.");
    }
    const token = opaque();
    await transaction(async client=>{
      if (row) {
        const current=(await client.query("select * from tesohub_music.admin_accounts where id=$1 for update",[row.id])).rows[0];
        if (!current?.active || current.password_hash !== expectedHash) throw fail(401,"Invalid admin login.");
        admin=identity(current);
        await client.query("update tesohub_music.admin_accounts set last_login_at=now() where id=$1",[row.id]);
      }
      await client.query(`insert into tesohub_music.admin_sessions(token_hash,admin_id,break_glass,recovery_key_hash,expires_at)
        values($1,$2,$3,$4,now()+interval '8 hours')`,[hash(token),admin.id,isRecovery,isRecovery?hash(breakGlass.token):null]);
      await audit(client,admin,"admin_login",admin.id);
      // Reset only this account after a committed login, never the source budget.
      await client.query("delete from tesohub_music.admin_login_limits where key_hash=$1",[accountKey]);
    });
    res.cookie(SESSION,token,{...cookieOptions("/admin-api"),maxAge:HOURS*3600000});
    res.json({admin});
  }
  async function freshActor(client, req, superOnly) {
    const resolved = await resolve(req, false, client);
    if (!resolved?.admin || (superOnly && resolved.admin.role !== "super_admin")) throw fail(403,"Forbidden");
    return resolved.admin;
  }
  async function securityWrite(req, fn, superOnly = true) {
    return transaction(async client=>{
      // Serializes bootstrap/last-owner checks and all account security changes
      // across connections, not just within one Node process.
      await client.query("select pg_advisory_xact_lock(864201,1)");
      const actor = await freshActor(client,req,superOnly);
      return fn(client,actor);
    });
  }
  async function create(req, bootstrap = false) {
    const body=req.body || {}, login=String(body.login_identifier||"").trim().toLowerCase(), name=String(body.display_name||"").trim();
    const role=body.role;
    if (bootstrap && role !== "super_admin") throw fail(400,"Bootstrap requires the explicit super_admin role.");
    if (!/^[a-z0-9][a-z0-9._@+-]{2,119}$/.test(login) || name.length<2 || name.length>100 || typeof role!=="string" || !Object.hasOwn(roles,role)) throw fail(400,"Enter a valid name, login identifier and role.");
    const passwordHash=await adminPasswordHash(body.password);
    try {return await securityWrite(req,async(client,actor)=>{
      if (bootstrap) {
        if(actor.auth_type!=="break_glass")throw fail(403,"Break-glass access is required for bootstrap.");
        if((await client.query("select 1 from tesohub_music.admin_accounts limit 1")).rowCount)throw fail(409,"Bootstrap is already complete. Use Admin Management.");
      } else if(actor.auth_type==="break_glass")throw fail(403,"Use bootstrap for the first account, then individual Admin Management.");
      const row=(await client.query(`insert into tesohub_music.admin_accounts(display_name,login_identifier,password_hash,role) values($1,$2,$3,$4) returning *`,[name,login,passwordHash,role])).rows[0];
      await audit(client,actor,bootstrap?"admin_bootstrap":"admin_created",row.id,{role});
      return publicRow(row);
    });}catch(error){if(error.code==="23505")throw fail(409,"That login identifier is already in use.");throw error;}
  }
  async function change(req) {
    return securityWrite(req,async(client,actor)=>{
      const row=(await client.query("select * from tesohub_music.admin_accounts where id=$1 for update",[req.params.id])).rows[0];
      if(!row)throw fail(404,"Admin not found.");
      if(req.body?.expected_updated_at && new Date(req.body.expected_updated_at).getTime()!==new Date(row.updated_at).getTime()) throw fail(409,"This Admin account changed. Refresh before updating access.");
      const role=req.body?.role??row.role, active=req.body?.active??row.active;
      if(typeof role!=="string"||!Object.hasOwn(roles,role)||typeof active!=="boolean")throw fail(400,"Invalid role or status.");
      if(row.active&&row.role==="super_admin"&&(!active||role!=="super_admin")){
        const count=(await client.query("select count(*)::int as n from tesohub_music.admin_accounts where active and role='super_admin'")).rows[0].n;
        if(count<=1)throw fail(409,"The final active Super Admin cannot be disabled or demoted.");
      }
      const updated=(await client.query("update tesohub_music.admin_accounts set role=$1,active=$2,updated_at=now() where id=$3 returning *",[role,active,row.id])).rows[0];
      await client.query("delete from tesohub_music.admin_sessions where admin_id=$1",[row.id]);
      await audit(client,actor,"admin_access_changed",row.id,{previous_role:row.role,role,active});
      return publicRow(updated);
    });
  }
  async function password(req, own) {
    const passwordHash=await adminPasswordHash(req.body?.password);
    return securityWrite(req,async(client,actor)=>{
      if(own&&actor.auth_type!=="individual")throw fail(400,"Break-glass credentials are managed outside this Console.");
      const id=own?actor.id:req.params.id;
      const row=(await client.query("select * from tesohub_music.admin_accounts where id=$1 for update",[id])).rows[0];
      if(!row)throw fail(404,"Admin not found.");
      if(own&&!await verifyAdminPassword(req.body?.current_password,row.password_hash))throw fail(401,"Current password is incorrect.");
      await client.query("update tesohub_music.admin_accounts set password_hash=$1,updated_at=now() where id=$2",[passwordHash,id]);
      await client.query("delete from tesohub_music.admin_sessions where admin_id=$1",[id]);
      await audit(client,actor,own?"admin_password_changed":"admin_password_reset",id);
      return {updated:true};
    },!own);
  }
  function install(app, requireAdmin, requireSuperAdmin) {
    const run = fn => async(req,res,next)=>{try{await fn(req,res);}catch(error){
      if(error.status)return res.status(error.status).json({detail:error.message});
      // Never send SQL errors, credentials or connection strings to the browser.
      res.status(503).json({detail:"Admin account service is unavailable. Try again later."});
    }};
    app.post("/admin-api/login",run((req,res)=>login(req,res)));
    app.post("/admin-api/break-glass-login",run((req,res)=>login(req,res,true)));
    app.post("/admin-api/logout",run(async(req,res)=>{
      if(req.adminSessionHash)await transaction(async client=>{
        await client.query("delete from tesohub_music.admin_sessions where token_hash=$1",[req.adminSessionHash]);
        await audit(client,req.adminIdentity,"admin_logout",req.adminIdentity.id);
      });
      res.clearCookie(SESSION,cookieOptions("/admin-api"));res.clearCookie(PREVIEW,cookieOptions("/api/"));res.status(204).end();
    }));
    app.get("/admin-api/admin-accounts",requireSuperAdmin,run(async(req,res)=>{
      res.json((await getPool().query("select * from tesohub_music.admin_accounts order by id")).rows.map(publicRow));
    }));
    app.post("/admin-api/admin-accounts/bootstrap",requireSuperAdmin,run(async(req,res)=>res.status(201).json(await create(req,true))));
    app.post("/admin-api/admin-accounts",requireSuperAdmin,run(async(req,res)=>res.status(201).json(await create(req))));
    app.patch("/admin-api/admin-accounts/:id",requireSuperAdmin,run(async(req,res)=>res.json(await change(req))));
    app.post("/admin-api/admin-accounts/:id/reset-password",requireSuperAdmin,run(async(req,res)=>res.json(await password(req,false))));
    app.post("/admin-api/change-password",requireAdmin,run(async(req,res)=>res.json(await password(req,true))));
    app.post("/admin-api/admin-accounts/:id/revoke-sessions",requireSuperAdmin,run(async(req,res)=>res.json(await securityWrite(req,async(client,actor)=>{
      const result=await client.query("delete from tesohub_music.admin_sessions where admin_id=$1",[req.params.id]);
      await audit(client,actor,"admin_sessions_revoked",req.params.id,{count:result.rowCount});return {revoked:result.rowCount};
    }))));
  }
  const recordAction = (req, action, target, details) => audit(getPool(),req.adminIdentity,action,target,details);
  return {middleware,audioMiddleware,preview,revokePreview,install,actorName,recordAction};
}
