import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { startPreview } from "./fixtures/admin-ui-preview.js";

test("Settings and Admin Management visual density", {timeout:120000}, async t => {
  assert.ok(process.env.TESO_PLAYWRIGHT_MODULE, "Configure the existing local Playwright dependency");
  const {chromium}=await import(pathToFileURL(process.env.TESO_PLAYWRIGHT_MODULE).href);
  const browser=await chromium.launch({headless:true,channel:"chrome"});
  const preview=await startPreview();
  t.after(async()=>{await browser.close();await new Promise(resolve=>preview.server.close(resolve));});
  const page=await browser.newPage();
  const errors=[];page.on("pageerror", e=>errors.push(e.message));
  async function open(view) {
    await page.locator(`#nav [data-view="${view}"]`).click();
    await page.waitForFunction(()=>!document.querySelector("#status").textContent.includes("Loading"));
    assert.equal(await page.locator("#view [role=alert]").count(),0);
  }
  async function fits() {
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"Horizontal overflow");
    const bad=await page.locator("#view input:not([type=hidden]),#view select,#view textarea,#view button").evaluateAll(items=>items.filter(el=>el.getClientRects().length).filter(el=>{const r=el.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.height<43;}).map(el=>el.name||el.textContent));
    assert.deepEqual(bad,[],"Clipped or undersized controls");
  }
  await page.goto(preview.url+"/?role=super_admin&large=1");
  await page.locator("#nav button").first().waitFor();
  for(const width of [320,390,1440]) {
    await t.test(`Settings groups and compact Admin rows at ${width}px`,async()=>{
      await page.setViewportSize({width,height:960});
      await open("settings");
      assert.deepEqual(await page.locator(".settings-group h2").allTextContents(),["Access & Onboarding","Platform Features","Upload Policy","Operations","Communications"]);
      assert.equal(await page.getByRole("switch").count(),8);
      assert.equal(await page.getByRole("switch",{name:"User registration",exact:true}).isChecked(),true);
      assert.equal(await page.getByRole("switch",{name:"Maintenance mode",exact:true}).isChecked(),false);
      await page.getByRole("switch",{name:"Maintenance mode",exact:true}).click();
      assert.equal(await page.getByRole("switch",{name:"Maintenance mode",exact:true}).isChecked(),true);
      await page.getByRole("switch",{name:"Maintenance mode",exact:true}).click();
      await fits();
      assert.ok(await page.locator(".settings-save button").evaluate(el=>el.getBoundingClientRect().width<200));
      await open("admins");
      if(width<=430) {
        for(const view of ["security","admins"]) {
          await open(view);
          const navigation=await page.locator(`#nav [data-view="${view}"]`).evaluate(el=>{const item=el.getBoundingClientRect(),region=el.parentElement.getBoundingClientRect();return {text:el.textContent,fullyVisible:item.left>=region.left-1&&item.right<=region.right+1,notTruncated:el.scrollWidth<=el.clientWidth};});
          assert.equal(navigation.text,view==="security"?"Account Security":"Admin Management");
          assert.equal(navigation.fullyVisible,true,`${view} is clipped at ${width}px`);
          assert.equal(navigation.notTruncated,true,`${view} label is truncated at ${width}px`);
        }
      }
      assert.equal(await page.locator(".admin-row").count(),25);
      assert.equal(await page.locator('[data-admin-form="access"]').count(),0);
      assert.equal(await page.locator("#adminCreatePanel").isVisible(),false);
      assert.ok(await page.locator("#view *").count()<800);
      const heights=await page.locator(".admin-summary").evaluateAll(rows=>rows.map(el=>el.getBoundingClientRect().height));
      assert.ok(heights.every(h=>width>=768?h>=60&&h<=90:h<=170),`Admin density ${width}: ${heights}`);
      await fits();
      assert.equal(await page.locator('[data-page-list="admins"] > .page-controls').count(),2);
      assert.match(await page.locator('.page-controls-top').innerText(),/1-25 of 125/);
      assert.match(await page.locator('.page-controls-bottom').innerText(),/1-25 of 125/);
      await page.locator('[data-manage-admin="1"]').click();
      assert.equal(await page.locator('[data-admin-form="access"]').count(),1);
      await page.locator('.admin-detail summary').filter({hasText:"Reset password"}).click();
      await fits();
      assert.equal(await page.locator('[data-admin-form="reset"] input').getAttribute("minlength"),"15");
      await page.locator('[data-manage-admin="2"]').click();
      assert.equal(await page.locator('[data-manage-admin][aria-expanded=true]').count(),1);
      assert.equal(await page.locator('[data-admin-form="access"]').getAttribute("data-id"),"2");
      await page.locator('[data-manage-admin="2"]').click();
      await page.locator("#adminCreateButton").click();
      assert.equal(await page.locator('#adminCreatePanel input[name="display_name"]').evaluate(el=>el===document.activeElement),true);
      await fits();
      await page.locator('#adminCreatePanel input[name="display_name"]').fill("Unsaved Admin draft");
      await page.locator('.page-controls-bottom [data-page-key="admins"][data-page-step="1"]').click();
      assert.equal(await page.locator('#adminCreatePanel input[name="display_name"]').inputValue(),"Unsaved Admin draft");
      assert.match(await page.locator('.page-controls-top').innerText(),/26-50 of 125/);
      assert.match(await page.locator('.page-controls-bottom').innerText(),/26-50 of 125/);
      await page.locator('.page-controls-top [data-page-key="admins"][data-page-step="-1"]').click();
      await page.locator('#adminCreatePanel button[data-admin-create-toggle]').click();
      assert.equal(await page.locator("#adminCreateButton").evaluate(el=>el===document.activeElement),true);
    });
  }
  await t.test("search/role/status filters, paging and drafts stay usable with 125 Admins",async()=>{
    const input=page.locator('[data-admin-filter="search"]');
    await input.pressSequentially("Preview Admin 0125");
    assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.locator(".admin-row").count(),1);
    await page.locator('[data-admin-filter="status"]').selectOption("true");
    assert.equal(await page.locator(".admin-row").count(),0);
    assert.ok(await page.getByText("No Admins match these filters.").isVisible());
    await page.locator('[data-admin-filter="status"]').selectOption("false");
    assert.equal(await page.locator(".admin-row").count(),1);
    await input.fill("");
    await page.locator('[data-admin-filter="status"]').selectOption("");
    await page.locator('[data-admin-filter="role"]').selectOption("support_admin");
    assert.equal(await page.locator(".admin-row").count(),25);
    assert.ok((await page.locator(".admin-role").allTextContents()).every(s=>s==="Support Admin"));
    await page.locator('.page-controls-bottom [data-page-key="admins"][data-page-step="1"]').click();
    assert.equal(await page.locator(".admin-row").count(),6);
    await page.locator('[data-admin-filter="role"]').selectOption("");
    assert.match(await page.locator('[data-page-list="admins"] .page-controls-top').innerText(),/1-25 of 125/);
  });
  await t.test("existing Settings values and Admin form contracts remain present",async()=>{
    await open("settings");
    const fields=await page.locator('#settingsForm [name]').evaluateAll(els=>els.map(el=>el.name).sort());
    assert.deepEqual(fields,["registration_enabled","artist_applications_enabled","music_uploads_enabled","maintenance_mode","playlists_enabled","artist_studio_enabled","offline_downloads_enabled","sharing_enabled","max_audio_upload_mb","max_artwork_upload_mb","supported_audio_formats","minimum_supported_app_version","maintenance_message","app_announcement"].sort());
    assert.equal(await page.locator('[name="max_audio_upload_mb"]').inputValue(),"80");
    await open("admins");await page.locator('[data-manage-admin="1"]').click();
    assert.equal(await page.locator('[data-admin-form="access"] input[name="expected_updated_at"]').count(),1);
    assert.equal(await page.locator('[data-admin-form="revoke"]').count(),1);
    assert.equal(await page.locator('[data-admin-form="reset"]').count(),1);
    assert.deepEqual(errors,[]);
    assert.deepEqual(preview.requests.filter(r=>r.method!=="GET"),[]);
  });
});
