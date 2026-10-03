// Browser integration test with intercepted API writes. Never changes production data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(process.argv[2] || "dist-sharing-review");
const artifacts = path.join(os.tmpdir(), "tesohub-sharing-review");
fs.mkdirSync(artifacts, { recursive: true });
const mime = { ".html": "text/html", ".js": "application/javascript", ".png": "image/png", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  let file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

async function verify(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
  const song = { id: 37, status: "published", title: "Sharing Test Song", artist: 11, artist_name: "Sharing Test Artist", cover_image: "", audio_file: "https://audio.example.test/test.wav", duration: 120 };
  const artist = { id: 11, name: song.artist_name, follower_count: 10, songs: [song] };
  let unavailable = false;
  let authenticated = false;
  const listener = { id: 101, name: "Share Tester", email: "share@example.test", role: "artist", liked_song_ids: [], followed_artist_ids: [] };
  const errors = [];
  await context.addInitScript(() => {
    window.shareCalls = [];
    window.copiedLinks = [];
    window.audioPlays = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { window.copiedLinks.push(value); } } });
    HTMLMediaElement.prototype.play = function () { window.audioPlays.push(this.src); this.dispatchEvent(new Event("play")); return Promise.resolve(); };
  });
  await context.route("**/api/**", async route => {
    const endpoint = new URL(route.request().url()).pathname.replace(/^.*\/api/, "");
    const send = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (endpoint === "/auth/me/") return authenticated ? send({ listener }) : send({ detail: "Login required" }, 401);
    if (endpoint === "/platform-status/") return send({ maintenance_mode: false });
    if (endpoint === "/songs/37/") return send({ ...song, status: unavailable ? "under_review" : "published" });
    if (/^\/songs\/[^/]+\/$/.test(endpoint) && endpoint !== "/songs/37/") return send({ detail: "Not found" }, 404);
    if (endpoint === "/songs/") return send([song]);
    if (endpoint === "/artists/") return send([artist]);
    if (endpoint === "/artists/11/") return send(artist);
    if (endpoint === "/artist-studio/dashboard/") return send({ artist, stats: {} });
    if (endpoint.startsWith("/artist-studio/releases/")) return send([
      { id: 1, title: "Live Release", status: "published", public_song: song },
      { id: 2, title: "Private Release", status: "draft", public_song: null },
      { id: 3, title: "Hidden Release", status: "published", public_song: { ...song, status: "hidden" } },
    ]);
    if (endpoint === "/songs/37/play/") return send(song);
    return send([]);
  });
  await context.route("https://audio.example.test/**", route => route.fulfill({ status: 200, body: "" }));
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const base = process.env.VERIFY_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const label = name => page.getByLabel(name, { exact: true }).filter({ visible: true });
  const text = name => page.getByText(name, { exact: true }).filter({ visible: true });
  try {
    await page.goto(`${base}/song/37`);
    await label("Play shared song").waitFor();
    await text(song.title).waitFor();
    await label("View artist profile").waitFor();
    await page.reload();
    await label("Play shared song").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, `song-${width}.png`), fullPage: true });
    await label("Share song").click();
    await label("Copy song link").waitFor();
    await label("Copy song link").click();
    await text("Link copied").waitFor();
    assert.deepEqual(await page.evaluate(() => window.copiedLinks), ["https://teso-music-app.onrender.com/song/37"]);
    await label("Share song link").click();
    assert.equal(await page.evaluate(() => window.copiedLinks.length), 2, "Unsupported Web Share falls back to copy");
    await page.screenshot({ path: path.join(artifacts, `share-${width}.png`), fullPage: true });
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: data => { window.shareCalls.push(data); return new Promise(resolve => setTimeout(resolve, 350)); } });
    });
    await label("Share song link").dblclick({ delay: 30 });
    await label("Close sharing").waitFor({ state: "hidden" });
    const shares = await page.evaluate(() => window.shareCalls);
    assert.equal(shares.length, 1, "Duplicate share taps are suppressed");
    assert.equal(shares[0].text, `Listen to ${song.title} by ${song.artist_name} on TesoHub Music`);
    assert.equal(shares[0].url, "https://teso-music-app.onrender.com/song/37");
    await label("Play shared song").click();
    await page.waitForURL("**/player");
    await page.waitForFunction(() => window.audioPlays.length > 0);
    assert.equal(await page.evaluate(() => window.audioPlays[0]), song.audio_file);
    await page.goto(`${base}/song/37`);
    await label("View artist profile").click();
    await page.waitForURL("**/artist/11");
    await text("10 followers").waitFor();
    await label("Open song menu").click();
    await label("Share song").click();
    await label("Copy song link").waitFor();
    await label("Close sharing").click();
    await label("Close add to playlist").click();
    unavailable = true;
    await page.goto(`${base}/song/37`);
    await text("Song unavailable").waitFor();
    assert.equal(await text(song.title).count(), 0);
    assert.equal(await label("Play shared song").count(), 0);
    await page.goto(`${base}/song/999999`);
    await text("Song unavailable").waitFor();
    unavailable = false;
    authenticated = true;
    await page.evaluate(listener => {
      localStorage.setItem("teso_tunes_auth_token", "test-only-token");
      localStorage.setItem("teso_tunes_auth_listener", JSON.stringify(listener));
    }, listener);
    await page.goto(`${base}/artist-studio`);
    await label("Share Live Release").waitFor();
    assert.equal(await label("Share Private Release").count(), 0);
    assert.equal(await label("Share Hidden Release").count(), 0);
    await label("Share Live Release").click();
    await label("Copy song link").waitFor();
    await label("Close sharing").click();
    assert.deepEqual(errors, []);
    console.log(`PASS sharing ${width}x${height}: exact route/reload, copy/fallback, web share/duplicate guard, playback handoff, artist menu, private/missing, Studio visibility`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `failure-${width}.png`), fullPage: true });
    throw error;
  } finally { await context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [1280, 900]]) await verify(browser, width, height);
    console.log(`Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
