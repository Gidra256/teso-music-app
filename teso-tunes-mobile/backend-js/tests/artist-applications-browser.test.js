import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const identity = {admin:{username:"fixture-admin",role:"super_admin",permissions:["*"]}};
const application = {id:1,listener:1,artist_name:"Fixture Stage",contact_name:"Fixture Contact",applicant:{id:1,name:"Fixture Listener",email:"listener@fixture.invalid"},email:"contact@fixture.invalid",phone:"0700000000",bio:"A synthetic artist application used only for local verification.",genre:"Gospel",country:"Uganda",region:"Teso",status:"pending",created_at:"2026-10-08T10:00:00Z",updated_at:"2026-10-08T10:00:00Z",genuine_confirmed:true,history:[]};

test("Artist Applications browser behavior and responsive layout", {skip:!process.env.TESO_PLAYWRIGHT_MODULE,timeout:90000},async t=>{
  const {chromium}=await import(pathToFileURL(process.env.TESO_PLAYWRIGHT_MODULE).href);
  const browser=await chromium.launch({headless:true,channel:"chrome"});
  let records=[],status=200,reviewCount=0,detailStatus=200,listDelay=0;
  const server=http.createServer(async(req,res)=>{
    if(req.url==="/"){res.setHeader("Content-Type","text/html");return res.end(html);}
    if(req.url==="/app-assets/images/tesohub-music.png") { res.setHeader("Content-Type","image/png");return res.end(fs.readFileSync(new URL("../../mobile/assets/images/tesohub-music.png",import.meta.url))); }
    if(!req.url.startsWith("/admin-api/")){res.writeHead(204);return res.end();}
    res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","no-store");
    let data=[];
    if(req.url==="/admin-api/me")data=identity;
    else if(req.url==="/admin-api/dashboard")data={pending_artist_applications:records.length};
    else if(req.url==="/admin-api/platform-health")data={backend_status:"ok",database:{}};
    else if(req.url==="/admin-api/artist-applications"){
      if(listDelay)await delay(listDelay);
      res.statusCode=status;data=status===200?records:{detail:"Fixture unavailable"};
    }else if(req.url==="/admin-api/artist-applications/1"){
      res.statusCode=detailStatus;data=detailStatus===200?records[0]:{detail:"Fixture unavailable"};
    }else if(req.url==="/admin-api/artist-applications/1/approve"){
      reviewCount++;await delay(120);
      records[0]={...records[0],status:"approved",artist:{id:9,name:"Fixture Stage"},reviewed_at:"2026-10-08T12:00:00Z",reviewed_by:"fixture-admin",history:[{action:"approve_artist_application",at:"2026-10-08T12:00:00Z",admin_user:"fixture-admin",admin_role:"content_admin",reason:""}]};data=records[0];
    }
    res.end(JSON.stringify(data));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const page=await browser.newPage();
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem("tesoAdminToken","fixture-browser-token"));
  page.on("dialog",dialog=>dialog.accept());
  async function open(){await page.goto(base);await page.locator('[data-view="applications"]').first().click();}
  const search=()=>page.locator("#applicationSearch");
  await t.test("genuine empty, new submission on re-entry, refresh and loading are distinct",async()=>{
    await open();await page.getByText("No artist applications have been submitted yet.").waitFor();
    records=[structuredClone(application)];
    await page.locator('[data-view="dashboard"]').first().click();
    await page.locator('[data-view="applications"]').first().click();
    await page.getByText("Fixture Stage",{exact:true}).waitFor();
    listDelay=150;const wait=page.waitForResponse(r=>r.url().endsWith("/admin-api/artist-applications"));
    await page.getByRole("button",{name:"Refresh",exact:true}).click();
    await page.getByText("Loading Artist Applications...").waitFor();await wait;listDelay=0;
    await search().waitFor();
  });
  await t.test("typing preserves focus and selection; search and status combine; clear restores All",async()=>{
    await search().click();await search().pressSequentially("fixture");
    assert.equal(await search().inputValue(),"fixture");assert.equal(await search().evaluate(el=>el===document.activeElement),true);
    await page.locator('[data-filter="applicationStatus"]').selectOption("approved");
    await page.getByText("No applications match your search or status filter.").waitFor();
    await page.getByRole("button",{name:"Clear filters"}).click();
    assert.equal(await search().inputValue(),"");assert.equal(await page.locator('[data-filter="applicationStatus"]').inputValue(),"");
    await page.locator('[data-filter="applicationStatus"]').selectOption("pending");
    await search().fill("listener@fixture.invalid");await page.getByText("Fixture Stage",{exact:true}).waitFor();
  });
  await t.test("HTTP 500 and 403 never become empty; Retry recovers without dropping session",async()=>{
    for(const code of [500,403]){
      status=code;await page.getByRole("button",{name:"Refresh",exact:true}).click();
      await page.getByRole("heading",{name:code===403?"Permission denied":"Could not load Artist Applications"}).waitFor();
      assert.equal(await page.locator("#view .empty").count(),0);
      status=200;await page.getByRole("button",{name:"Retry",exact:true}).click();await search().waitFor();
      assert.equal(await search().inputValue(),"listener@fixture.invalid");
    }
  });
  await t.test("320/360/390/tablet/desktop list and detail fit and navigation stays compact",async()=>{
    for(const width of [320,360,390,768,1440]){
      await page.setViewportSize({width,height:900});
      const clear = page.getByRole("button",{name:"Clear filters"});
      if (await clear.isVisible()) await clear.click();
      const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,top:document.querySelector("#view").getBoundingClientRect().top}));
      assert.ok(geometry.scroll<=width,`Overflow at ${width}`);assert.ok(geometry.top<400,`Applications pushed down at ${width}`);
      await page.getByRole("button",{name:"Review",exact:true}).click();await page.getByRole("heading",{name:"Review history"}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Detail overflow at ${width}`);
      for(const action of ["Approve","Reject","Request changes"]){const box=await page.getByRole("button",{name:action,exact:true}).boundingBox();assert.ok(box.height>=44);assert.ok(box.x>=0&&box.x+box.width<=width);}
      if(process.env.TESO_APPLICATION_SCREENSHOTS){fs.mkdirSync(process.env.TESO_APPLICATION_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.TESO_APPLICATION_SCREENSHOTS,`applications-detail-${width}.png`),fullPage:true});}
      await page.getByRole("button",{name:"Back to applications"}).click();await search().waitFor();
      if(process.env.TESO_APPLICATION_SCREENSHOTS)await page.screenshot({path:path.join(process.env.TESO_APPLICATION_SCREENSHOTS,`applications-list-${width}.png`),fullPage:true});
    }
  });
  await t.test("review detail failure/permission states, required rejection reason and duplicate approval guard",async()=>{
    detailStatus=403;await page.getByRole("button",{name:"Review",exact:true}).click();await page.getByRole("heading",{name:"Permission denied"}).waitFor();
    detailStatus=200;await page.getByRole("button",{name:"Retry",exact:true}).click();await page.getByRole("heading",{name:"Review history"}).waitFor();
    await page.getByRole("button",{name:"Reject",exact:true}).click();await page.getByText("Enter a clear review reason.",{exact:true}).waitFor();
    await page.locator('[data-action="approve-application"]').evaluate(button=>{button.click();button.dispatchEvent(new MouseEvent("click",{bubbles:true}));});
    await page.getByText("approve artist application:",{exact:false}).waitFor();assert.equal(reviewCount,1);
    await page.getByRole("button",{name:"Back to applications"}).click();await search().waitFor();
    await page.locator('[data-filter="applicationStatus"]').selectOption("approved");await page.getByText("Fixture Stage",{exact:true}).waitFor();
  });
  assert.deepEqual(errors,[]);
});
