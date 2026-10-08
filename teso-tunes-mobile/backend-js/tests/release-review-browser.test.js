import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {test} from "node:test";

const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const identity={admin:{username:"fixture-admin",role:"content_admin",permissions:["applications","artists","catalog","discovery","genres","releases"]}};
const release={id:1,title:"Fixture release",artist:1,artist_name:"Fixture artist",listener:{id:1,name:"Fixture account"},status:"under_review",release_type:"Single",genre:"Gospel",language:"Ateso",rights_confirmed:true,linkage_valid:true,release_date:"2099-01-01",submitted_at:"2026-10-08T10:00:00.000Z",updated_at:"2026-10-08T10:00:00.000Z",history:[],cover_image:"/app-assets/images/tesohub-music.png",audio_file:"/api/releases/1/audio/"};

function syntheticWav(){
  const samples=8000*8,bytes=Buffer.alloc(44+samples*2);
  bytes.write("RIFF",0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write("WAVEfmt ",8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write("data",36);bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(600*Math.sin(2*Math.PI*220*i/8000)),44+i*2);
  return bytes;
}

test("Release Review browser, preview and responsive behavior",{skip:!process.env.TESO_PLAYWRIGHT_MODULE,timeout:90000},async t=>{
  const {chromium}=await import(pathToFileURL(process.env.TESO_PLAYWRIGHT_MODULE).href);
  const browser=await chromium.launch({headless:true,channel:"chrome"});
  let records=[],status=200,detailStatus=200,listDelay=0,reads=0,decisions=0,audioError=false,audioRanges=0;
  const wave=syntheticWav();
  const server=http.createServer(async(req,res)=>{
    if(req.url==="/"){res.setHeader("Content-Type","text/html");return res.end(html);}
    if(req.url==="/app-assets/images/tesohub-music.png"){res.setHeader("Content-Type","image/png");return res.end(fs.readFileSync(new URL("../../mobile/assets/images/tesohub-music.png",import.meta.url)));}
    if(req.url.startsWith("/api/releases/1/audio/")){
      if(audioError){res.writeHead(503);return res.end();}
      if(!req.headers.cookie?.includes("fixture-preview=yes")){res.writeHead(404);return res.end();}
      const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||"");const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),wave.length-1):wave.length-1;
      res.setHeader("Content-Type","audio/wav");res.setHeader("Cache-Control","no-store");res.setHeader("Accept-Ranges","bytes");
      if(range){audioRanges++;res.statusCode=206;res.setHeader("Content-Range",`bytes ${start}-${end}/${wave.length}`);}
      res.setHeader("Content-Length",end-start+1);return res.end(wave.subarray(start,end+1));
    }
    if(!req.url.startsWith("/admin-api/")){res.writeHead(204);return res.end();}
    res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","no-store");let data=[];
    // Model asynchronous preview-session renewal so Retry cannot accidentally
    // pass only because a loopback identity response beat the test's play call.
    if(req.url==="/admin-api/me"){await delay(250);res.setHeader("Set-Cookie","fixture-preview=yes; HttpOnly; SameSite=Strict; Max-Age=900; Path=/api");data=identity;}
    else if(req.url==="/admin-api/dashboard")data={};
    else if(req.url==="/admin-api/releases"){reads++;const snapshot=structuredClone(records);if(listDelay)await delay(listDelay);res.statusCode=status;data=status===200?snapshot:{detail:"Fixture unavailable"};}
    else if(req.url==="/admin-api/releases/1"){res.statusCode=detailStatus;data=detailStatus===200?records[0]:{detail:"Fixture unavailable"};}
    else if(req.url==="/admin-api/releases/1/approve"){
      let body="";for await(const chunk of req)body+=chunk;assert.equal(JSON.parse(body).expected_updated_at,records[0].updated_at);
      decisions++;await delay(150);records[0]={...records[0],status:"scheduled",approved_at:"2026-10-08T12:00:00.000Z",history:[{action:"approve_release",at:"2026-10-08T12:00:00.000Z",admin_user:"fixture-admin"}]};data=records[0];
    }
    res.end(JSON.stringify(data));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});
  const page=await browser.newPage();page.setDefaultTimeout(8000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem("tesoAdminToken","fixture-browser-token"));page.on("dialog",dialog=>dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-view="releases"]').first().click();
  const search=()=>page.locator("#releaseSearch");
  await t.test("true empty then fresh submissions on re-entry, loading, refresh and attention-first",async()=>{
    await page.getByText("No releases have been submitted yet.").waitFor();
    records=[{...release,id:2,title:"Already published",status:"published"},structuredClone(release)];
    await page.locator('[data-view="dashboard"]').first().click();await page.locator('[data-view="releases"]').first().click();await page.getByText(release.title,{exact:true}).waitFor();
    assert.equal(await page.locator("#releaseResults .item-title").first().textContent(),release.title);assert.equal(await page.locator('[data-action="approve-release"]').count(),0);
    const before=reads;listDelay=200;await page.getByRole("button",{name:"Refresh",exact:true}).click();await page.getByText("Loading Release Review...").waitFor();await search().waitFor();listDelay=0;assert.equal(reads,before+1);
  });
  await t.test("search retains focus; status/search combine; clear filters restores all",async()=>{
    await search().click();await search().pressSequentially("fixture");assert.equal(await search().evaluate(el=>el===document.activeElement),true);
    await page.locator('[data-filter="releaseStatus"]').selectOption("rejected");await page.getByText("No releases match your search or status filter.").waitFor();
    await page.getByRole("button",{name:"Clear filters"}).click();assert.equal(await search().inputValue(),"");
    await page.locator('[data-filter="releaseStatus"]').selectOption("under_review");assert.equal(await page.locator("#releaseResults .item").count(),1);
  });
  await t.test("list and detail errors/permission denied never become empty, Retry recovers",async()=>{
    for(const code of [500,403]){status=code;await page.getByRole("button",{name:"Refresh",exact:true}).click();await page.getByRole("heading",{name:code===403?"Permission denied":"Could not load Release Review"}).waitFor();assert.equal(await page.locator("#view .empty").count(),0);status=200;await page.getByRole("button",{name:"Retry",exact:true}).click();await search().waitFor();}
    records=[structuredClone(release)];detailStatus=403;await page.getByRole("button",{name:"Review",exact:true}).click();await page.getByRole("heading",{name:"Permission denied"}).waitFor();
    detailStatus=200;await page.getByRole("button",{name:"Retry",exact:true}).click();await page.getByRole("heading",{name:"Review history"}).waitFor();
  });
  await t.test("320/360/390/768/1440 list and dedicated review fit; artwork/audio/actions reachable",async()=>{
    for(const width of [320,360,390,768,1440]){
      await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Detail overflow ${width}`);
      for(const name of ["Approve","Reject","Request changes"]){const box=await page.getByRole("button",{name,exact:true}).boundingBox();assert.ok(box.height>=44);assert.ok(box.x>=0&&box.x+box.width<=width);}
      assert.equal(await page.locator(".release-artwork").evaluate(img=>img.complete&&img.naturalWidth>0),true);
      const audio=await page.locator("audio").boundingBox();assert.ok(audio.x>=0&&audio.x+audio.width<=width);
      if(process.env.TESO_REVIEW_SCREENSHOTS){fs.mkdirSync(process.env.TESO_REVIEW_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.TESO_REVIEW_SCREENSHOTS,`release-detail-${width}.png`),fullPage:true});}
      await page.getByRole("button",{name:"Back to releases"}).click();await search().waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`List overflow ${width}`);
      if(process.env.TESO_REVIEW_SCREENSHOTS)await page.screenshot({path:path.join(process.env.TESO_REVIEW_SCREENSHOTS,`release-list-${width}.png`),fullPage:true});
      await page.getByRole("button",{name:"Review",exact:true}).click();await page.getByRole("heading",{name:"Review history"}).waitFor();
    }
  });
  await t.test("HttpOnly preview plays/seeks via Range without changing release; error/retry and buffering feedback",async()=>{
    assert.ok(!(await page.evaluate(()=>document.cookie)).includes("fixture-preview"));
    await page.locator("audio").evaluate(async audio=>{audio.muted=true;await audio.play();});await page.waitForFunction(()=>document.querySelector("audio").currentTime>0.15);
    await page.locator("audio").evaluate(audio=>{audio.currentTime=4;});await page.waitForFunction(()=>document.querySelector("audio").currentTime>=4);
    await page.locator("audio").evaluate(audio=>audio.pause());assert.ok(audioRanges>0);assert.equal(records[0].status,"under_review");
    await page.locator("audio").evaluate(audio=>audio.dispatchEvent(new Event("waiting")));await page.getByText("Buffering...",{exact:true}).waitFor();
    // A distinct synthetic URL avoids Chrome reusing decoded in-memory audio.
    audioError=true;await page.locator("audio").evaluate(audio=>{audio.src="/api/releases/1/audio/?fixture=error";audio.load();audio.play().catch(()=>{});});await page.getByText("Audio could not load. Retry or refresh your Admin session.").waitFor();
    audioError=false;
    const renewedSession=page.waitForResponse(response=>response.url().endsWith("/admin-api/me")&&response.status()===200);
    const retriedAudio=page.waitForResponse(response=>response.url().includes("/api/releases/1/audio/?fixture=error")&&response.status()===206);
    await page.getByRole("button",{name:"Retry audio"}).click();
    await renewedSession;
    const response=await retriedAudio;
    assert.match(response.headers()["content-range"],/^bytes \d+-\d+\/\d+$/);
    // The click handler awaits identity renewal before load(). Observe its real
    // completion; never clear errors or call load() from the test to force success.
    await page.waitForFunction(()=>{const audio=document.querySelector("audio");return !audio.error&&audio.readyState>=3;});
    await page.locator("audio").evaluate(async audio=>{await audio.play();});
    await page.waitForFunction(()=>document.querySelector("audio").currentTime>0.15);
    await page.locator("audio").evaluate(audio=>audio.pause());
    assert.equal(records[0].status,"under_review");
    assert.ok(!(await page.evaluate(()=>document.cookie)).includes("fixture-preview"));
  });
  await t.test("required reason and duplicate click protection send one revision-bound decision",async()=>{
    await page.getByRole("button",{name:"Reject",exact:true}).click();await page.getByText("Enter a meaningful review reason (at least 5 characters).",{exact:true}).waitFor();
    await page.locator('[data-action="approve-release"]').evaluate(button=>{button.click();button.dispatchEvent(new MouseEvent("click",{bubbles:true}));});
    await page.getByText("approve release:",{exact:false}).waitFor();assert.equal(decisions,1);assert.equal(await page.locator('[data-action="approve-release"]').count(),0);
  });
  await t.test("publication inspection filters are read-only and responsive",async()=>{
    records=[
      {...release,status:"scheduled",publication:{candidate:true,timing:"due",eligible:true,reason:""}},
      {...release,id:2,title:"Future fixture",status:"scheduled",publication:{candidate:true,timing:"future",eligible:false,reason:"The scheduled date has not arrived (UTC)."}},
      {...release,id:3,title:"Legacy approval",status:"approved",publication:{candidate:true,timing:"due",eligible:false,reason:"Legacy approved state requires review."}},
      {...release,id:4,title:"Review fixture",publication:{candidate:false,timing:"unscheduled",eligible:false,reason:"Not approved or scheduled."}},
    ];
    const snapshot=structuredClone(records),before=decisions;
    await page.getByRole("button",{name:"Back to releases"}).click();await search().waitFor();
    await page.getByRole("button",{name:"Clear filters"}).click();
    const publication=page.locator('[data-filter="releasePublication"]');
    for(const [value,count] of [["approved_scheduled",3],["due",2],["future",1],["eligible",1]]){
      await publication.selectOption(value);assert.equal(await page.locator("#releaseResults .item").count(),count);
    }
    await page.getByText("Eligible when publisher is enabled",{exact:false}).waitFor();
    for(const width of [320,360,390,768,1440]){
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Publication filter overflow ${width}`);
      const box=await publication.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
    }
    await page.getByRole("button",{name:"Clear filters"}).click();assert.equal(await publication.inputValue(),"");
    assert.equal(await page.locator("#releaseResults .item").count(),4);
    assert.equal(decisions,before);assert.deepEqual(records,snapshot);
  });
  assert.deepEqual(errors,[]);
});
