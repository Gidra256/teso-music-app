import fs from "node:fs";
import http from "node:http";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

// Loopback-only, synthetic, read-only preview. No production client or credentials.
export const roles = {
  super_admin: ["*"],
  content_admin: ["applications", "artists", "catalog", "discovery", "genres", "releases"],
  moderator: ["reports", "users", "artists", "catalog"],
  support_admin: ["support:view", "support:reply", "support:note", "support:update"],
};
const date = "2026-10-09T08:00:00Z";
const image = "/app-assets/images/tesohub-music.png";
const artist = {id:1,name:"Local Fixture Artist",category:"Gospel Artists",status:"active",photo:image,bio:"Synthetic preview record.",follower_count:12,stream_count:320,is_featured:true};
const song = {id:1,title:"Local Fixture Song",artist:1,artist_name:artist.name,genre:"Gospel",status:"published",is_featured:true,cover_image:image,audio_file:"/fixture-audio.wav",like_count:8,play_count:320};
const application = {id:1,listener:1,artist_name:"Local Fixture Applicant",contact_name:"Preview Contact",email:"preview@example.invalid",applicant:{id:1,name:"Preview Listener",email:"preview@example.invalid"},photo:image,bio:"Synthetic application for local layout verification only.",genre:"Gospel",country:"Uganda",region:"Teso",status:"pending",created_at:date,updated_at:date,genuine_confirmed:true,history:[]};
const release = {id:1,title:"Local Fixture Release",artist:1,artist_name:artist.name,genre:"Gospel",language:"Ateso",status:"under_review",cover_image:image,audio_file:"/fixture-audio.wav",release_type:"single",rights_confirmed:true,linkage_valid:true,listener:{id:1,name:"Preview Listener"},created_at:date,updated_at:date,submitted_at:date,history:[]};
const ticket = {id:1,reference:"TSH-PREVIEW",subject:"Local fixture playback question",category:"Playback",status:"open",priority:"normal",user_id:1,account_email:"preview@example.invalid",message:"Synthetic support request.",created_at:date,updated_at:date,messages:[{id:1,author_type:"user",message:"Please help with this preview question.",created_at:date,attachments:[]}],internal_notes:[],attachments:[],user:{name:"Preview Listener",email:"preview@example.invalid",role:"listener"}};
const numbered=(prefix,id)=>`${prefix} ${String(id).padStart(4,"0")}`;
const large = {
  artists:Array.from({length:500},(_,i)=>({...artist,id:i+1,name:numbered("Scale Artist",i+1)})),
  songs:Array.from({length:2000},(_,i)=>({...song,id:i+1,title:numbered("Scale Song",i+1),artist:i%500+1,artist_name:numbered("Scale Artist",i%500+1),release_date:"2026-10-09"})),
  applications:Array.from({length:250},(_,i)=>({...application,id:i+1,artist_name:numbered("Scale Application",i+1)})),
  releases:Array.from({length:250},(_,i)=>({...release,id:i+1,title:numbered("Scale Release",i+1)})),
  tickets:Array.from({length:500},(_,i)=>({...ticket,id:i+1,subject:numbered("Scale Support",i+1)})),
  audit:Array.from({length:100},(_,i)=>({id:i+1,admin_username:"Preview Operator",action:numbered("Fixture audit",i+1),created_at:date})),
};
const history=Array.from({length:250},(_,i)=>({action:"fixture_review",at:date,admin_user:"Preview Operator",reason:numbered("History",i+1)}));

function silentAudio() {
  const bytes=Buffer.alloc(44+16000);
  bytes.write("RIFF");bytes.writeUInt32LE(bytes.length-8,4);bytes.write("WAVEfmt ",8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);
  bytes.writeUInt16LE(16,34);bytes.write("data",36);bytes.writeUInt32LE(16000,40);
  return bytes;
}

export async function startPreview(port=0) {
  const requests=[];
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,"http://127.0.0.1");
    res.setHeader("Cache-Control","no-store");
    if(url.pathname==="/") {
      const requested=url.searchParams.get("role") || "super_admin";
      const role=Object.hasOwn(roles,requested)?requested:"super_admin";
      res.setHeader("Set-Cookie",[`fixture_role=${role}; HttpOnly; SameSite=Strict; Path=/`,`fixture_large=${url.searchParams.get("large")==="1"?"1":"0"}; HttpOnly; SameSite=Strict; Path=/`]);
      res.setHeader("Content-Type","text/html");
      const html=fs.readFileSync(new URL("../../public/index.html",import.meta.url),"utf8");
      return res.end(html.replace("<title>TesoHub", "<title>LOCAL FIXTURE - TesoHub").replace("<body>",'<body><p style="padding:8px 16px;background:#38240c;color:#ffcf70;font-size:12px">LOCAL PREVIEW / synthetic data / changes are not saved</p>'));
    }
    if(url.pathname===image) {res.setHeader("Content-Type","image/png");return res.end(fs.readFileSync(new URL("../../../mobile/assets/images/tesohub-music.png",import.meta.url)));}
    if(url.pathname==="/fixture-audio.wav") {res.setHeader("Content-Type","audio/wav");return res.end(silentAudio());}
    if(url.pathname==="/favicon.ico") {res.writeHead(204);return res.end();}
    requests.push({method:req.method,path:url.pathname});
    res.setHeader("Content-Type","application/json");
    if(req.method!=="GET") {res.writeHead(405);return res.end(JSON.stringify({detail:"Read-only local preview. Changes are not saved."}));}
    const role=req.headers.cookie?.match(/fixture_role=([a-z_]+)/)?.[1] || "super_admin";
    const permissions=roles[role] || [];
    const isLarge=req.headers.cookie?.includes("fixture_large=1");
    const allowed=permission=>permissions.includes("*") || permissions.includes(permission);
    const resources={
      "/admin-api/me":{admin:{id:1,username:"local-preview",display_name:"Preview Operator",role,permissions,auth_type:"individual"}},
      "/admin-api/dashboard":{total_users:24,total_approved_artists:4,pending_artist_applications:1,total_published_songs:12,releases_under_review:1,total_streams:320,new_users_7d:3,new_releases_7d:2,reports_requiring_attention:0},
      "/admin-api/platform-health":{backend_status:"Local fixture",database:{},warnings:[]},
      "/admin-api/artists":[artist],
      "/admin-api/songs":[song],
      "/admin-api/genres":[{id:1,name:"Gospel",position:1,active:true}],
      "/admin-api/artist-applications":[application],
      "/admin-api/artist-applications/1":application,
      "/admin-api/releases":[release],
      "/admin-api/releases/1":release,
      "/admin-api/support/tickets":[ticket],
      "/admin-api/support/tickets/1":ticket,
      "/admin-api/users":[{id:1,name:"Preview Listener",email:"preview@example.invalid",role:"listener",status:"active",created_at:date}],
      "/admin-api/reports":[],
      "/admin-api/audit-log":[],
      "/admin-api/platform-settings":{registration_enabled:true,artist_applications_enabled:true,music_uploads_enabled:true,maintenance_mode:false,max_audio_upload_mb:80,max_artwork_upload_mb:10,supported_audio_formats:["mp3","wav","m4a"],minimum_supported_app_version:"1.0.6",maintenance_message:"We'll be back shortly. Thank you for your patience.",app_announcement:"",feature_flags:{playlists_enabled:true,artist_studio_enabled:true,sharing_enabled:true,offline_downloads_enabled:false}},
      "/admin-api/feature-flags":{},
      "/admin-api/admin-accounts":Object.entries(roles).map(([accountRole,accountPermissions],index)=>({id:index+1,display_name:`Preview ${accountRole.replaceAll("_"," ")}`,login_identifier:`preview-${index+1}@example.invalid`,role:accountRole,permissions:accountPermissions,active:index!==3,created_at:date,updated_at:date,last_login_at:index===0?date:null})),
    };
    if(isLarge) {
      const accountRoles=Object.keys(roles);
      resources["/admin-api/admin-accounts"]=Array.from({length:125},(_,i)=>({id:i+1,display_name:numbered("Preview Admin",i+1),login_identifier:`preview-${String(i+1).padStart(3,"0")}@example.invalid`,role:accountRoles[i%4],permissions:roles[accountRoles[i%4]],active:i%5!==4,created_at:date,updated_at:date,last_login_at:i%3===0?date:null}));
      Object.assign(resources,{
        "/admin-api/artists":large.artists,"/admin-api/songs":large.songs,
        "/admin-api/artist-applications":large.applications,"/admin-api/releases":large.releases,
        "/admin-api/support/tickets":large.tickets,"/admin-api/audit-log":large.audit,
      });
      const detail=url.pathname.match(/^\/admin-api\/(releases|artist-applications)\/(\d+)$/);
      if(detail) {
        const row=(detail[1]==="releases"?large.releases:large.applications).find(r=>r.id===Number(detail[2]));
        if(row)resources[url.pathname]={...row,history};
      }
    }
    const required={"admin-accounts":"*","platform-health":"*","audit-log":"*","platform-settings":"settings","feature-flags":"settings","artist-applications":"applications",releases:"releases",support:"support:view",users:"users",reports:"reports",songs:"catalog",artists:"artists",genres:"genres"}[url.pathname.split("/")[2]];
    // Catalog also reads the genre list under the existing backend contract.
    if(required && !allowed(required) && !(required==="genres" && allowed("catalog"))) {res.writeHead(403);return res.end(JSON.stringify({detail:"Fixture role does not have access."}));}
    if(!Object.hasOwn(resources,url.pathname)) {res.writeHead(404);return res.end(JSON.stringify({detail:"Unknown fixture route"}));}
    res.end(JSON.stringify(resources[url.pathname]));
  });
  server.listen(port,"127.0.0.1");await once(server,"listening");
  return {server,requests,url:`http://127.0.0.1:${server.address().port}`};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const preview=await startPreview(Number(process.argv[2] || 55178));
  console.log(`Read-only synthetic Admin preview: ${preview.url}`);
}
