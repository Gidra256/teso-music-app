import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { startPreview } from "./fixtures/admin-ui-preview.js";

const widths=[320,360,390,430,768,1024,1280,1440];
const navigation={
  super_admin:["dashboard","applications","releases","catalog","artists","users","support","reports","discovery","genres","settings","health","audit","admins","security"],
  content_admin:["dashboard","applications","releases","catalog","artists","discovery","genres","security"],
  moderator:["dashboard","catalog","artists","users","reports","security"],
  support_admin:["support","security"],
};

test("Admin UI polish: role-aware responsive workflows", {skip:!process.env.TESO_PLAYWRIGHT_MODULE,timeout:180000},async t=>{
  const {chromium}=await import(pathToFileURL(process.env.TESO_PLAYWRIGHT_MODULE).href);
  const browser=await chromium.launch({headless:true,channel:"chrome"});
  const preview=await startPreview();
  t.after(async()=>{await browser.close();await new Promise(resolve=>preview.server.close(resolve));});
  const page=await browser.newPage();
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  const screenshotDir=process.env.TESO_ADMIN_UI_SCREENSHOTS;
  async function screenshot(name) {
    if(!screenshotDir)return;
    fs.mkdirSync(screenshotDir,{recursive:true});
    await page.screenshot({path:path.join(screenshotDir,`${name}.png`),fullPage:true});
  }
  async function open(key) {
    await page.locator(`#nav [data-view="${key}"]`).click();
    await page.waitForFunction(()=>!document.querySelector("#status")?.textContent.includes("Loading"));
    assert.equal(await page.locator("#view [role=alert]").count(),0,`Unexpected error in ${key}`);
  }
  async function fits(label) {
    const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
      bad:[...document.querySelectorAll("#view input:not([type=hidden]), #view select, #view textarea, #view button, #view audio")].filter(el=>el.getClientRects().length).filter(el=>{const b=(el.type==="checkbox" ? el.closest("label") : el).getBoundingClientRect();return b.x<0 || b.right>innerWidth+1 || b.height<43;}).map(el=>el.id || el.textContent || el.name)}));
    assert.ok(result.scroll<=result.width,`${label}: page overflow ${JSON.stringify(result)}`);
    assert.deepEqual(result.bad,[],`${label}: clipped or undersized controls`);
  }
  for(const [role,keys] of Object.entries(navigation)) {
    await t.test(`${role}: exact permitted navigation and usable screens at all eight widths`,async()=>{
      await page.goto(`${preview.url}/?role=${role}`);
      await page.locator("#nav button").first().waitFor();
      assert.deepEqual(await page.locator("#nav [data-view]").evaluateAll(items=>items.map(el=>el.dataset.view)),keys);
      assert.equal(await page.locator(".admin-name").textContent(),"Preview Operator");
      for(const width of widths) {
        await page.setViewportSize({width,height:900});
        for(const key of keys) {
          await open(key);await fits(`${role}/${key}/${width}`);
          assert.equal(await page.locator(`#nav [data-view="${key}"]`).getAttribute("aria-current"),"page");
          assert.ok(await page.locator(`#nav [data-view="${key}"]`).evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;}),`Selected navigation hidden: ${key}/${width}`);
          assert.ok(await page.locator("#logoutButton").isVisible());
        }
      }
      await screenshot(`${role}-security-1440`);
    });
  }
  await t.test("review details, audio, Admin access and support actions fit all eight widths",async()=>{
    await page.goto(`${preview.url}/?role=super_admin`);await page.locator("#nav button").first().waitFor();
    for(const width of widths) {
      await page.setViewportSize({width,height:900});
      for(const [key,action] of [["applications","review-application"],["releases","review-release"]]) {
        await open(key);await page.locator(`[data-action="${action}"]`).click();
        await page.getByRole("heading",{name:"Review decision",exact:true}).waitFor();
        await fits(`${key} detail ${width}`);
        if(key==="releases") {
          await page.waitForFunction(()=>document.querySelector("#releaseAudio").readyState>=1);
          assert.ok(await page.locator("#releaseAudio").evaluate(el=>el.duration>0));
        }
        if([390,1440].includes(width))await screenshot(`${key}-${width}`);
      }
      await open("admins");
      await page.locator('.admin-account details').filter({has:page.locator('summary', {hasText:"Reset password"})}).first().locator("summary").click();
      await fits(`Admin Management ${width}`);
      assert.equal(await page.locator('.admin-account .badge.danger').count(),1);
      assert.ok(await page.getByText("Role and status changes take effect after Update access.",{exact:false}).first().isVisible());
      assert.ok(await page.getByText("Revoke signs this Admin out",{exact:false}).first().isVisible());
      if([390,1440].includes(width))await screenshot(`admin-management-${width}`);
      await open("support");
      const supportReload=page.waitForResponse(response=>new URL(response.url()).pathname==="/admin-api/support/tickets");
      await page.locator('[data-action="open-support"]').click();await supportReload;
      await page.locator("#supportNoteForm").waitFor();
      await fits(`Support detail ${width}`);
      assert.ok(await page.locator("#supportNoteForm.support-internal").isVisible());
      if([390,1440].includes(width))await screenshot(`support-${width}`);
    }
  });
  await t.test("search retains focus/caret; empty state, scroll, keyboard focus and real metrics remain intact",async()=>{
    await page.setViewportSize({width:1440,height:900});
    for(const [key,name] of [["catalog","catalogSearch"],["users","userSearch"],["support","supportSearch"]]) {
      await open(key);const input=page.locator(`[data-filter="${name}"]`);
      await input.click();await input.pressSequentially("no-match");
      assert.equal(await input.inputValue(),"no-match");
      assert.ok(await input.evaluate(el=>el===document.activeElement));
      assert.equal(await input.evaluate(el=>el.selectionStart),8);
      assert.ok(await page.locator("#view .empty").first().isVisible());
      await input.fill("");
    }
    await open("dashboard");
    assert.equal(await page.locator(".stat-value").count(),9);
    assert.equal(await page.locator(".stat-value").first().textContent(),"24");
    for(const width of [390,1440]){await page.setViewportSize({width,height:900});await screenshot(`dashboard-${width}`);}
    await page.locator("#logoutButton").focus();await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),"solid");
  });
  await t.test("large collections stay bounded, dense and responsive at every requested width",async()=>{
    await page.goto(`${preview.url}/?role=super_admin&large=1`);
    await page.locator("#nav button").first().waitFor();
    const timings=[];
    for(const width of widths) {
      await page.setViewportSize({width,height:900});
      for(const [key,list,total] of [["artists","artists",500],["catalog","catalog",2000],["applications","applications",250],["releases","releases",250],["support","support",500],["audit","audit",100]]) {
        const started=Date.now();
        await open(key);
        const region=page.locator(`[data-page-list="${list}"]`);
        assert.equal(await region.locator(":scope > .item").count(),25,`Unbounded ${key}`);
        assert.match(await region.locator(".page-controls").innerText(),new RegExp(`of ${total.toLocaleString()}`));
        assert.ok(await page.locator("#view *").count()<2500,`Excess DOM in ${key}`);
        const heights=await region.locator(":scope > .item").evaluateAll(rows=>rows.map(el=>el.getBoundingClientRect().height).sort((a,b)=>a-b));
        if(["artists","catalog","applications","releases"].includes(key))assert.ok(heights[12]<(width<681?220:180),`Oversized ${key} row at ${width}: ${heights[12]}`);
        await fits(`large ${key}/${width}`);
        if(["artists","catalog"].includes(key)) {
          const menu=region.locator(".row-menu summary").first();
          await menu.click();await fits(`expanded ${key}/${width}`);await menu.click();
        }
        const first=await region.locator(".item-title").first().textContent();
        if(key==="catalog")await page.locator('#songForm input[name="title"]').fill("Unsaved draft");
        await region.locator('[data-page-step="1"]').click();
        assert.notEqual(await region.locator(".item-title").first().textContent(),first);
        assert.equal(await region.locator(":scope > .item").count(),25);
        if(key==="catalog")assert.equal(await page.locator('#songForm input[name="title"]').inputValue(),"Unsaved draft");
        await region.locator('[data-page-step="-1"]').click();
        assert.equal(await region.locator(".item-title").first().textContent(),first);
        const elapsed=Date.now()-started;
        assert.ok(elapsed<5000,`Slow navigation/page interaction: ${key}/${width} ${elapsed}ms`);
        timings.push({width,view:key,elapsed});
        if([320,1440].includes(width))await screenshot(`large-${key}-${width}`);
      }
    }
    t.diagnostic("Large catalog navigation + next/previous timings: "+JSON.stringify(timings));
  });
  await t.test("large-list search finds distant records, resets pages, and bounds the artist picker",async()=>{
    await open("artists");
    await page.locator('[data-page-key="artists"][data-page-step="1"]').click();
    await page.locator('[data-filter="artistSearch"]').fill("Scale Artist 0500");
    assert.equal(await page.locator('[data-page-list="artists"] > .item').count(),1);
    await page.locator('[data-filter="artistStatus"]').selectOption("suspended");
    assert.equal(await page.locator('[data-page-list="artists"] > .item').count(),0);
    await page.locator('[data-filter="artistStatus"]').selectOption("");
    await page.locator('[data-filter="artistSearch"]').fill("");
    assert.match(await page.locator('[data-page-list="artists"] .page-controls').innerText(),/1-25 of 500/);
    await open("catalog");
    assert.ok(await page.locator('#songForm select[name="artist"] option').count()<=27);
    await page.locator("[data-artist-options]").fill("Scale Artist 0500");
    await page.locator('#songForm select[name="artist"]').selectOption("500");
    await page.locator("[data-artist-options]").fill("Scale Artist 0001");
    assert.equal(await page.locator('#songForm select[name="artist"]').inputValue(),"500");
    await page.locator('[data-filter="catalogSearch"]').fill("Scale Song 2000");
    assert.equal(await page.locator('#songForm select[name="artist"]').inputValue(),"500","Filtering the list must not discard the form");
    assert.equal(await page.locator('[data-page-list="catalog"] > .item').count(),1);
    await page.locator('.row-menu summary').click();
    await fits("expanded large-catalog row");
    assert.equal(await page.locator(".row-menu audio").getAttribute("preload"),"none");
    await page.locator('[data-action="edit-song"]').click();
    assert.equal(await page.locator('#songForm select[name="artist"]').inputValue(),"500");
    assert.ok(await page.locator('#songForm select[name="artist"] option').count()<=27);
    await page.locator('[data-filter="catalogSearch"]').fill("");
  });
  await t.test("long review histories paginate without changing the review reason",async()=>{
    for(const key of ["applications","releases"]) {
      await open(key);
      await page.locator(`[data-action="review-${key==="applications"?"application":"release"}"]`).first().click();
      await page.getByRole("heading",{name:"Review decision",exact:true}).waitFor();
      const region=page.locator('.application-history [data-page-list]');
      assert.equal(await region.locator(".history-entry").count(),25);
      await page.locator(".review-decision textarea").fill("Unsaved review reason");
      await region.locator('[data-page-step="1"]').click();
      assert.equal(await region.locator(".history-entry").count(),25);
      assert.equal(await page.locator(".review-decision textarea").inputValue(),"Unsaved review reason");
    }
    assert.deepEqual(errors,[]);
    assert.deepEqual(preview.requests.filter(r=>r.method!=="GET"),[],"UI inspection must not submit mutations");
  });
});
