const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const serve = require("./pwa-test-server.cjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const artifactDir = path.join(os.tmpdir(), "tesohub-pwa-parity");
fs.mkdirSync(artifactDir, { recursive: true });
const song = { id: 37, status: "published", title: "Parity Song", artist: 11, artist_name: "Parity Artist", duration: 120 };
const listener = { id: 101, name: "Parity Tester", liked_song_ids: [], followed_artist_ids: [] };
const expectedDownload = process.env.EXPECT_ANDROID_DOWNLOAD_URL || "";

async function fixture(browser, width, height, authenticated, standalone = false, userAgent) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: width < 900,
    userAgent: userAgent || (width < 900 ? "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36" : undefined), serviceWorkers: "block" });
  await context.addInitScript(({ authenticated, listener, standalone }) => {
    localStorage.setItem("tesohub_music_onboarding_v1", "completed");
    if (authenticated) {
      localStorage.setItem("teso_tunes_auth_token", "fixture");
      localStorage.setItem("teso_tunes_auth_listener", JSON.stringify(listener));
    }
    if (standalone) {
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => { const media = original(query); if (query === "(display-mode: standalone)") Object.defineProperty(media, "matches", { value: true }); return media; };
    }
  }, { authenticated, listener, standalone });
  const writes = [];
  let playlist = { id: 22, name: "Test list", songs: [], song_count: 0 };
  await context.route("**/api/**", async route => {
    const req = route.request(), p = new URL(req.url()).pathname.replace(/^.*\/api/, "");
    const send = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (req.method() !== "GET") writes.push(`${req.method()} ${p}`);
    if (p === "/auth/me/") return authenticated ? send({ listener }) : send({}, 401);
    if (p === "/platform-status/") return send({ maintenance_mode: false });
    if (p === "/songs/37/") return send(song);
    if (p === "/artists/11/") return send({ id: 11, name: "Parity Artist", songs: [song], follower_count: 0 });
    if (p === "/songs/") return send([song]);
    if (p === "/playlists/" && req.method() === "POST") {
      await new Promise(r => setTimeout(r, 200));
      playlist = { ...playlist, ...req.postDataJSON() }; return send(playlist, 201);
    }
    if (p === "/playlists/22/") return send(playlist);
    if (p === "/playlists/22/songs/" && req.method() === "POST") {
      await new Promise(r => setTimeout(r, 200));
      playlist = { ...playlist, songs: [song], song_count: 1 }; return send({ playlist });
    }
    if (p === "/playlists/") return send([playlist]);
    return send([]);
  });
  return { context, writes, page: await context.newPage() };
}

(async () => {
  const { server, url } = process.env.VERIFY_BASE_URL ? { server: { close() {} }, url: process.env.VERIFY_BASE_URL } : await serve(process.argv[2]);
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    for (const [width, height] of [[320, 568], [360, 800], [390, 844], [768, 1024], [1280, 900]]) {
      const { context, page, writes } = await fixture(browser, width, height, true);
      try {
        await page.goto(`${url}/create`);
        const input = page.getByPlaceholder("My Teso Mix");
        await input.tap(); assert.equal(await input.evaluate(e => e === document.activeElement), true, "Touch must retain input focus");
        await page.evaluate(() => {
          Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 330 });
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await input.fill("Touch Test Mix");
        const create = page.getByText("Create Playlist", { exact: true });
        await create.scrollIntoViewIfNeeded();
        const box = await create.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 331, "Create stays inside reduced visual viewport");
        await page.screenshot({ path: path.join(artifactDir, `keyboard-${width}.png`) });
        await input.press("Enter");
        await page.waitForURL("**/playlist/22");
        await page.getByText("Touch Test Mix", { exact: true }).waitFor();
        assert.equal(writes.filter(w => w === "POST /playlists/").length, 1);
        await page.goto(`${url}/songs`);
        await page.getByLabel("Open song menu", { exact: true }).first().click();
        await page.getByLabel("Add to Playlist", { exact: true }).click();
        await page.getByText("Create new playlist", { exact: true }).click();
        const addInput = page.getByPlaceholder("Playlist name");
        await addInput.tap(); assert.equal(await addInput.evaluate(e => e === document.activeElement), true);
        await addInput.fill("Created from song");
        await addInput.press("Enter");
        await page.getByText("Added to Created from song.", { exact: true }).waitFor();
        assert.equal(writes.filter(w => w === "POST /playlists/").length, 2);
        assert.equal(writes.filter(w => w === "POST /playlists/22/songs/").length, 1);
        await page.goto(`${url}/song/37`);
        await page.getByText("Parity Song", { exact: true }).waitFor();
        if (expectedDownload && width < 900) {
          let downloads = 0;
          await context.route(expectedDownload, route => {
            downloads++;
            return route.fulfill({ contentType: "application/vnd.android.package-archive", headers: { "Content-Disposition": 'attachment; filename="download-fixture.apk"' }, body: Buffer.from("PK\u0003\u0004") });
          });
          page.once("dialog", dialog => { assert.match(dialog.message(), /Android Early Access APK.*not Google Play/); return dialog.dismiss(); });
          await page.getByText("Get Android App", { exact: true }).click();
          assert.equal(downloads, 0, "Cancel must not download");
          page.once("dialog", dialog => dialog.accept());
          const downloaded = page.waitForEvent("download");
          await page.getByText("Get Android App", { exact: true }).click();
          assert.equal((await downloaded).url(), expectedDownload);
          assert.equal(downloads, 1, "Only an explicit confirmation downloads");
        }
        await page.getByText("Install Web App", { exact: true }).click();
        await page.getByText(/browser (menu|address bar)/).waitFor();
        await page.evaluate(() => {
          window.installCalls = 0;
          const event = new Event("beforeinstallprompt", { cancelable: true });
          event.prompt = async () => { window.installCalls++; };
          event.userChoice = Promise.resolve({ outcome: "dismissed" });
          window.dispatchEvent(event);
        });
        await page.getByText("Install Web App", { exact: true }).click();
        assert.equal(await page.evaluate(() => window.installCalls), 1);
        await page.getByText("Take TesoHub Music with you", { exact: true }).waitFor({ state: "hidden" });
        if (width < 900) await page.getByText("Open App", { exact: true }).waitFor();
        else assert.equal(await page.getByText("Open App", { exact: true }).count(), 0);
        assert.equal(await page.getByText("Get Android App", { exact: true }).count(), expectedDownload && width < 900 ? 1 : 0, "Download action only for Android with an approved destination");
        await page.reload(); await page.getByText("Parity Song", { exact: true }).waitFor();
        assert.equal(await page.getByText("Install Web App", { exact: true }).count(), 0, "Dismissal survives reload");
        await page.evaluate(() => localStorage.removeItem("tesohub_install_dismissed_until"));
        await page.reload(); await page.getByTestId("app-access").waitFor();
        await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
        await page.getByText("Take TesoHub Music with you", { exact: true }).waitFor({ state: "hidden" });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        console.log(`PASS ${width}x${height}: direct Create, touch focus, keyboard viewport, Enter submit, exact song, manual install, deferred prompt, dismissal, installed hiding`);
      } catch (error) {
        console.error(`Viewport ${width}: ${page.url()}, writes: ${JSON.stringify(writes)}`);
        console.error((await page.locator("body").innerText()).slice(-2000));
        await page.screenshot({ path: path.join(artifactDir, `failure-${width}.png`) });
        throw error;
      } finally { await context.close(); }
      const guest = await fixture(browser, width, height, false);
      try {
        await guest.page.goto(`${url}/create`);
        await guest.page.getByText("Create Account", { exact: true }).waitFor();
        await guest.page.getByText("Log In", { exact: true }).waitFor();
        await guest.page.getByText("Keep Listening", { exact: true }).click();
        await guest.page.waitForURL("**/library");
        assert.equal(guest.writes.length, 0);
        await guest.page.goto(`${url}/playlist/22`);
        await guest.page.getByText("Log In / Create Account", { exact: true }).waitFor();
        await guest.page.goto(`${url}/artist/11`);
        await guest.page.getByText("Parity Artist", { exact: true }).first().waitFor();
        await guest.page.screenshot({ path: path.join(artifactDir, `artist-${width}.png`), fullPage: true });
      } finally { await guest.context.close(); }
    }
    const standalone = await fixture(browser, 390, 844, false, true);
    await standalone.page.goto(`${url}/song/37`); await standalone.page.getByText("Parity Song", { exact: true }).waitFor();
    assert.equal(await standalone.page.getByText("Install Web App", { exact: true }).count(), 0);
    await standalone.context.close();
    const iphone = await fixture(browser, 390, 844, false, false, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1");
    await iphone.page.goto(`${url}/song/37?app_fallback=1`);
    await iphone.page.getByText("Parity Song", { exact: true }).waitFor();
    await iphone.page.getByText("Add to Home Screen", { exact: true }).click();
    await iphone.page.getByText(/In Safari, open Share/).waitFor();
    assert.equal(await iphone.page.getByText("Open App", { exact: true }).count(), 0);
    assert.equal(await iphone.page.getByText("Get Android App", { exact: true }).count(), 0);
    await iphone.context.close();
    const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "tesohub-install-check-")), { channel: "msedge", headless: true }); const page = await context.newPage();
    await page.goto(`${url}/song/1`);
    await page.waitForFunction(() => !!document.querySelector('link[rel="manifest"]'));
    await page.evaluate(() => navigator.serviceWorker.ready);
    const manifest = await (await fetch(`${url}/manifest.webmanifest`)).json();
    assert.equal(manifest.start_url, "/"); assert.equal(manifest.display, "standalone");
    for (const icon of manifest.icons) {
      const bytes = Buffer.from(await (await fetch(url + icon.src)).arrayBuffer());
      assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
    }
    const cdp = await context.newCDPSession(page);
    const result = await cdp.send("Page.getAppManifest"); assert.deepEqual(result.errors, []);
    const installability = await cdp.send("Page.getInstallabilityErrors");
    console.log("Browser installability diagnostics:", JSON.stringify(installability.installabilityErrors));
    assert.deepEqual(installability.installabilityErrors, []);
    await context.close();
    console.log(`PASS guest prompts, shared artist/playlist routes, standalone hiding, manifest/icon dimensions and real service worker; screenshots: ${artifactDir}`);
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
