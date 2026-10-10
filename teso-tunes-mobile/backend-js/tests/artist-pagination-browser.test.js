import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { startPreview } from "./fixtures/admin-ui-preview.js";

test("Admin Artists uses bounded server paging, filtering and detail loading", {skip: !process.env.TESO_PLAYWRIGHT_MODULE, timeout: 60000}, async (t) => {
  const { chromium } = await import(pathToFileURL(process.env.TESO_PLAYWRIGHT_MODULE).href);
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const preview = await startPreview();
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => preview.server.close(resolve));
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${preview.url}/?role=super_admin&large=1`);
  const firstPageResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/admin-api/artists" && url.searchParams.get("page") === "1" && !url.searchParams.get("compat");
  });
  await page.locator('#nav [data-view="artists"]').click();
  const firstPayload = await (await firstPageResponse).json();
  assert.equal(firstPayload.items.length, 25);
  assert.equal(firstPayload.total, 500);
  assert.equal(firstPayload.total_pages, 20);
  assert.equal(firstPayload.has_next, true);
  const list = page.locator('[data-server-page-list="artists"]');
  await list.waitFor();
  assert.equal(await list.locator(":scope > .item").count(), 25);
  assert.match(await list.locator(".page-controls").innerText(), /1-25 of 500/);
  const firstArtist = await list.locator(".item-title").first().textContent();

  const secondPageResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get("page") === "2");
  await list.locator('[data-artist-page="2"]').click();
  const secondPayload = await (await secondPageResponse).json();
  assert.equal(secondPayload.items.length, 25);
  assert.equal(new Set([...firstPayload.items, ...secondPayload.items].map((artist) => artist.id)).size, 50);
  assert.notEqual(await page.locator('[data-server-page-list="artists"] .item-title').first().textContent(), firstArtist);

  const searchResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get("search") === "Scale Artist 0500");
  await page.locator('[data-filter="artistSearch"]').fill("Scale Artist 0500");
  const searchPayload = await (await searchResponse).json();
  assert.equal(searchPayload.page, 1);
  assert.equal(searchPayload.total, 1);
  assert.equal(await page.locator('[data-server-page-list="artists"] > .item').count(), 1);

  const filteredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.searchParams.get("search") === "Scale Artist 0500" && url.searchParams.get("status") === "suspended";
  });
  await page.locator('[data-filter="artistStatus"]').selectOption("suspended");
  const filteredPayload = await (await filteredResponse).json();
  assert.equal(filteredPayload.page, 1);
  assert.equal(filteredPayload.total, 0);
  assert.ok(await page.locator("#artistResults .empty").isVisible());

  const resetResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/admin-api/artists" && !url.searchParams.get("search") && !url.searchParams.get("status");
  });
  await page.locator('[data-filter="artistStatus"]').selectOption("");
  await page.locator('[data-filter="artistSearch"]').fill("");
  await resetResponse;
  await page.locator('[data-server-page-list="artists"] > .item').first().waitFor();

  await page.locator('[data-server-page-list="artists"] .row-menu summary').first().click();
  const detailResponse = page.waitForResponse((response) => /\/admin-api\/artists\/\d+$/.test(new URL(response.url()).pathname));
  await page.locator('[data-action="edit-artist"]').first().click();
  const detailPayload = await (await detailResponse).json();
  assert.equal(await page.locator('#artistForm input[name="name"]').inputValue(), detailPayload.name);
  assert.equal(await page.locator('#artistForm textarea[name="bio"]').inputValue(), detailPayload.bio);
  assert.deepEqual(errors, []);
});
