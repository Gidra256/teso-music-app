// Production-export checks. API writes and audio are mocked, never sent to production.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(process.argv[2] || "dist-onboarding-review");
const artifacts = path.join(os.tmpdir(), "tesohub-onboarding-review");
fs.mkdirSync(artifacts, { recursive: true });
const mime = { ".html": "text/html", ".js": "application/javascript", ".png": "image/png", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  let file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
const key = "tesohub_music_onboarding_v1";
const song = { id: 37, status: "published", title: "Onboarding Test Song", artist: 11, artist_name: "Onboarding Artist", cover_image: "", audio_file: "https://audio.example.test/test.wav", duration: 120 };
const artist = { id: 11, name: song.artist_name, follower_count: 10, songs: [song] };

async function fixture(browser, width, height, seed = {}) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
  const writes = [], errors = [];
  await context.addInitScript(seed => {
    if (!localStorage.getItem("test_seeded")) {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
      localStorage.setItem("test_seeded", "yes");
    }
    window.audioPlays = [];
    HTMLMediaElement.prototype.play = function () { window.audioPlays.push(this.src); this.dispatchEvent(new Event("play")); return Promise.resolve(); };
  }, seed);
  await context.route("**/api/**", route => {
    const req = route.request();
    const endpoint = new URL(req.url()).pathname.replace(/^.*\/api/, "");
    const send = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (req.method() === "POST") { writes.push(endpoint); return send(song); }
    if (endpoint === "/platform-status/") return send({ maintenance_mode: false });
    if (["/songs/", "/featured-songs/"].includes(endpoint)) return send([song]);
    if (["/artists/", "/featured-artists/"].includes(endpoint)) return send([artist]);
    if (endpoint === "/songs/37/") return send(song);
    if (endpoint === "/artists/11/") return send(artist);
    if (endpoint === "/support/help-center/") return send({ categories: { listener: [], artist: [] }, articles: [] });
    return send([]);
  });
  await context.route("https://audio.example.test/**", r => r.fulfill({ status: 200, body: "" }));
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const base = process.env.VERIFY_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const label = name => page.getByLabel(name, { exact: true }).filter({ visible: true });
  const text = name => page.getByText(name, { exact: true }).filter({ visible: true });
  return { context, page, base, label, text, writes, errors };
}

async function verify(browser, width, height) {
  const { context, page, base, text, label, writes, errors } = await fixture(browser, width, height);
  try {
    await page.goto(base);
    await text("Welcome to TesoHub Music").waitFor();
    await text("Discover Teso music and the artists behind it.").waitFor();
    const start = text("Start Listening");
    const startBox = await start.boundingBox();
    const skipBox = await label("Skip onboarding").boundingBox();
    assert.ok(startBox.y + startBox.height <= height, "Primary action remains on screen");
    assert.ok(skipBox.height >= 44);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, `welcome-${width}.png`), fullPage: true });
    if (width === 320) {
      await label("Skip onboarding").click();
      await page.waitForFunction(key => localStorage.getItem(key) === "skipped", key);
    } else {
      await start.click();
      await page.waitForFunction(key => localStorage.getItem(key) === "completed", key);
    }
    await text("Featured songs").waitFor();
    const songBox = await text(song.title).first().boundingBox();
    assert.ok(songBox.y + songBox.height < height - 60, "Featured song title is visible after onboarding");
    await page.screenshot({ path: path.join(artifacts, `home-${width}.png`), fullPage: true });
    await page.reload();
    await text("Featured songs").waitFor();
    assert.equal(await text("Welcome to TesoHub Music").count(), 0);
    await label(`Like ${song.title}`).first().click();
    await text("Make it yours").waitFor();
    await text("Sign in or create an account to save likes, follow artists and keep your playlists across devices. You can listen to public songs without an account.").waitFor();
    await label("Create account").waitFor();
    await page.screenshot({ path: path.join(artifacts, `account-prompt-${width}.png`), fullPage: true });
    await text("Keep listening").click();
    await text("Featured songs").waitFor();
    await page.goto(`${base}/artist/11`);
    await text("Follow").click();
    await text("Make it yours").waitFor();
    await text("Keep listening").click();
    await page.waitForURL("**/artist/11");
    await page.goto(`${base}/library`);
    await label("Create playlist").click();
    await text("Make it yours").waitFor();
    await text("Keep listening").click();
    await page.waitForURL("**/library");
    await page.goto(base);
    await text("Create").click();
    await text("Make it yours").waitFor();
    await label("Open Help and Support").click();
    await text("Get Help").waitFor();
    assert.deepEqual(writes, [], "No unauthenticated like/follow/playlist writes");
    assert.deepEqual(errors, []);
    console.log(`PASS onboarding ${width}x${height}: first launch, completion/skip, reopen, discovery, guest auth prompts, dismiss/back, support, no writes`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `failure-${width}.png`), fullPage: true });
    throw error;
  } finally { await context.close(); }
}

async function sharedLink(browser) {
  const { context, page, base, text, label, writes, errors } = await fixture(browser, 390, 844);
  try {
    await page.goto(`${base}/song/37`);
    await label("Play shared song").waitFor();
    assert.equal(await text("Welcome to TesoHub Music").count(), 0);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null, "Link does not mark onboarding completed");
    await label("Like song").click();
    await text("Make it yours").waitFor();
    await text("Keep listening").click();
    await page.waitForURL("**/song/37");
    await label("Play shared song").click();
    await page.waitForFunction(() => window.audioPlays.length > 0);
    assert.equal(await page.evaluate(() => window.audioPlays[0]), song.audio_file);
    assert.ok(writes.every(item => item === "/songs/37/play/"));
    await page.goto(`${base}/song/37`);
    await label("Play shared song").waitFor();
    await text("Discover more music").click();
    await text("Featured songs").waitFor();
    assert.equal(await text("Welcome to TesoHub Music").count(), 0, "No delayed onboarding after shared-link session");
    assert.deepEqual(errors, []);
    console.log("PASS fresh shared link: no onboarding/signup barrier, guest playback, dismissible Like prompt returns to song, discovery stays open");
  } finally { await context.close(); }
}

async function existingGuest(browser) {
  const seed = { teso_tunes_recently_played: JSON.stringify([song]) };
  const { context, page, base, text } = await fixture(browser, 390, 844, seed);
  try {
    await page.goto(base);
    await text("Featured songs").waitFor();
    await page.waitForFunction(key => localStorage.getItem(key) === "existing-user", key);
    assert.equal(await text("Welcome to TesoHub Music").count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("teso_tunes_recently_played")), seed.teso_tunes_recently_played);
    console.log("PASS previous guest listening history suppresses onboarding without changing history");
  } finally { await context.close(); }
}

async function warmLinkAndStorageFailure(browser) {
  const first = await fixture(browser, 390, 844);
  try {
    await first.page.goto(first.base);
    await first.text("Welcome to TesoHub Music").waitFor();
    await first.page.evaluate(() => {
      history.pushState({}, "", "/song/37");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await first.label("Play shared song").waitFor();
    assert.equal(await first.text("Welcome to TesoHub Music").count(), 0);
    console.log("PASS incoming shared route dismisses active onboarding");
  } finally { await first.context.close(); }
  const second = await fixture(browser, 390, 844);
  try {
    await second.context.addInitScript(key => {
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) {
        if (name === key) throw new Error("Simulated unavailable preference storage");
        return getItem.call(this, name);
      };
    }, key);
    await second.page.goto(second.base);
    await second.text("Featured songs").waitFor();
    assert.equal(await second.text("Welcome to TesoHub Music").count(), 0);
    assert.deepEqual(second.errors, []);
    console.log("PASS failed preference storage does not block Home or listening");
  } finally { await second.context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1280, 900]]) await verify(browser, width, height);
    await sharedLink(browser);
    await existingGuest(browser);
    await warmLinkAndStorageFailure(browser);
    console.log(`Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
