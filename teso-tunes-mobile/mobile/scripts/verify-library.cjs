// Run against a production web export. All API traffic is mocked; no live data is written.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(process.argv[2] || "dist-library-review");
const artifacts = path.join(os.tmpdir(), "tesohub-library-review");
fs.mkdirSync(artifacts, { recursive: true });
const mime = { ".js": "application/javascript", ".html": "text/html", ".png": "image/png", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

async function verify(browser, width, height) {
  const errors = [];
  const calls = [];
  const likes = new Set([1]);
  const follows = new Set([11]);
  let failNextLike = false;
  let displayName = "Library Tester";
  let role = "listener";
  const songs = [1, 2].map(id => ({ id, title: `Test Song ${id}`, artist: 11, artist_name: "Test Artist", genre: "Test", like_count: 3, cover_image: "", audio_file: "", duration: 120 }));
  const artist = { id: 11, name: "Test Artist", category: "Test", photo: "", follower_count: 10, songs };
  const playlists = [{ id: 21, name: "Test Mix", song_count: 1, songs: [songs[0]] }];
  const account = () => ({ id: 101, name: displayName, email: "library@example.test", role, liked_song_ids: [...likes], followed_artist_ids: [...follows] });
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
  await context.addInitScript(({ listener, songs }) => {
    if (localStorage.getItem("library_test_seeded")) return;
    localStorage.setItem("library_test_seeded", "yes");
    localStorage.setItem("teso_tunes_auth_token", "test-only-token");
    localStorage.setItem("teso_tunes_auth_listener", JSON.stringify(listener));
    localStorage.setItem("teso_tunes_device_id", "test-only-device");
    localStorage.setItem("teso_tunes_liked_songs", "[2]");
    localStorage.setItem("teso_tunes_followed_artists", "[99]");
    localStorage.setItem("teso_tunes_recently_played", JSON.stringify(songs));
  }, { listener: account(), songs });
  await context.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^.*\/api/, "");
    const method = request.method();
    calls.push(`${method} ${endpoint}`);
    const send = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (endpoint === "/auth/me/") {
      if (method === "PUT") displayName = request.postDataJSON().name;
      return send({ listener: account() });
    }
    if (endpoint === "/auth/logout/") return send({ detail: "Logged out" });
    if (endpoint === "/support/help-center/") return send({ categories: { listener: [], artist: [] }, articles: [] });
    if (endpoint === "/artist-applications/me/") return send({ application: null });
    if (endpoint === "/artist-studio/dashboard/") return send({ artist, stats: {} });
    if (endpoint === "/platform-status/") return send({ maintenance_mode: false });
    if (endpoint === "/songs/") return send(songs);
    if (endpoint === "/artists/") return send([{ ...artist, follower_count: follows.has(11) ? 10 : 9 }]);
    if (endpoint === "/artists/11/") return send({ ...artist, follower_count: follows.has(11) ? 10 : 9 });
    const like = endpoint.match(/^\/songs\/(\d+)\/(like|unlike)\/$/);
    if (like) {
      await new Promise(resolve => setTimeout(resolve, 180));
      if (failNextLike) { failNextLike = false; return send({ detail: "Test network failure" }, 503); }
      if (like[2] === "like") likes.add(Number(like[1]));
      else likes.delete(Number(like[1]));
      return send({ liked: likes.has(Number(like[1])), like_count: likes.has(Number(like[1])) ? 3 : 2 });
    }
    const follow = endpoint.match(/^\/artists\/11\/(follow|unfollow)\/$/);
    if (follow) {
      if (follow[1] === "follow") follows.add(11);
      else follows.delete(11);
      return send({ followed: follows.has(11), follower_count: follows.has(11) ? 10 : 9 });
    }
    if (endpoint === "/playlists/" && method === "POST") {
      const item = { ...request.postDataJSON(), id: 22, song_count: 0, songs: [] };
      playlists.push(item);
      return send(item, 201);
    }
    if (endpoint === "/playlists/") return send(playlists);
    const playlist = endpoint.match(/^\/playlists\/(\d+)\/$/);
    if (playlist) return send(playlists.find(item => item.id === Number(playlist[1])));
    return send([]);
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.dismiss());
  const url = process.env.VERIFY_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const text = name => page.getByText(name, { exact: true }).filter({ visible: true });
  const label = name => page.getByLabel(name, { exact: true }).filter({ visible: true });
  const tab = name => page.getByRole("tab", { name, exact: true });
  try {
    await page.goto(`${url}/profile`);
    await text("Edit Profile").waitFor();
    for (const name of ["Settings", "Help & Support", "Become an Artist"]) await text(name).waitFor();
    await label("Logout").waitFor();
    assert.equal(await text("Liked songs").count(), 0);
    assert.equal(await text("Following artists").count(), 0);
    assert.equal(await text("Following").count(), 0);
    assert.equal(await text("Taste").count(), 0);
    assert.equal(calls.some(call => /GET \/(songs|artists)\//.test(call)), false, "Profile must not fetch catalogs");
    await page.screenshot({ path: path.join(artifacts, `profile-${width}.png`), fullPage: true });
    await page.getByPlaceholder("Profile name").fill("Edited Tester");
    const saved = page.waitForResponse(r => r.url().endsWith("/auth/me/") && r.request().method() === "PUT");
    await label("Save profile").click();
    await saved;
    assert.equal(displayName, "Edited Tester");
    await label("Open Help and Support").click();
    await text("Get Help").waitFor();
    await text("My Support Requests").click();
    await text("No support requests yet").waitFor();
    await page.goto(`${url}/profile`);
    await text("Become an Artist").waitFor();
    await text("Become an Artist").locator("..").locator("..").locator('[tabindex="0"]').click();
    await text("Artist application").waitFor();
    role = "artist";
    await page.goto(`${url}/profile`);
    await text("Artist Studio").last().waitFor();
    await text("Artist Studio").last().locator("..").locator("..").locator('[tabindex="0"]').click();
    await page.waitForURL("**/artist-studio");
    await text("Test Artist").waitFor();
    role = "listener";

    await page.goto(`${url}/library`);
    await text("Test Mix").waitFor();
    await tab("Liked Songs").click();
    await text("Test Song 1").waitFor();
    assert.equal(await text("Test Song 2").count(), 0, "Server replaces stale cached likes");
    const unlikeResponse = page.waitForResponse(r => r.url().endsWith("/songs/1/unlike/"));
    await label("Unlike Test Song 1").click();
    await text("Test Song 1").waitFor({ state: "hidden" });
    await unlikeResponse;
    assert.equal(likes.has(1), false);
    await page.reload();
    await text("Test Mix").waitFor();
    await tab("Liked Songs").click();
    await text("Nothing here yet").waitFor();

    await tab("Recently Played").click();
    const likeResponse = page.waitForResponse(r => r.url().endsWith("/songs/1/like/"));
    await label("Like Test Song 1").click();
    await label("Unlike Test Song 1").waitFor();
    await likeResponse;
    await tab("Liked Songs").click();
    await text("Test Song 1").waitFor();

    await tab("Recently Played").click();
    failNextLike = true;
    const failedResponse = page.waitForResponse(r => r.url().endsWith("/songs/2/like/"));
    await label("Like Test Song 2").click();
    await failedResponse;
    await label("Like Test Song 2").waitFor();
    await tab("Liked Songs").click();
    await text("Test Song 1").waitFor();
    assert.equal(await text("Test Song 2").count(), 0, "Failed like rolls back");

    await tab("Following Artists").click();
    await text("Test Artist").waitFor();
    await text("10 followers").waitFor();
    await text("Test Artist").click();
    await text("Following").click();
    await text("9 followers").waitFor();
    await text("UNDO").click();
    await text("10 followers").waitFor();
    await page.goBack();
    await text("Test Artist").waitFor();
    await text("Following").click();
    await text("No followed artists yet").waitFor();
    assert.equal(follows.size, 0);
    await page.reload();
    await text("Test Mix").waitFor();
    await tab("Following Artists").click();
    await text("No followed artists yet").waitFor();

    await page.goto(`${url}/artists`);
    await text("Follow").click();
    await text("Following").waitFor();
    await text("10 followers").waitFor();
    await page.goto(`${url}/library`);
    await text("Test Mix").waitFor();
    await tab("Following Artists").click();
    await text("Test Artist").waitFor();
    const artistNameBox = await text("Test Artist").boundingBox();
    assert.ok(artistNameBox.y + artistNameBox.height < height - 70, "Artist thumbnail must not push its name below the viewport");
    await page.screenshot({ path: path.join(artifacts, `library-${width}.png`), fullPage: true });
    await tab("Downloads").click();
    await text("Offline downloads are not enabled yet.").waitFor();

    await tab("Playlists").click();
    await label("Create playlist").click();
    await page.getByPlaceholder("My Teso Mix").fill("Created Mix");
    await text("Create Playlist").click();
    await text("Created Mix").waitFor();
    await page.goto(`${url}/library`);
    await text("Created Mix").waitFor();
    await tab("Liked Songs").click();
    await text("Test Song 1").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.goto(`${url}/profile`);
    await page.getByPlaceholder("Profile name").waitFor();
    assert.equal(await page.getByPlaceholder("Profile name").inputValue(), "Edited Tester");
    const loggedOut = page.waitForResponse(r => r.url().endsWith("/auth/logout/"));
    await label("Logout").click();
    await loggedOut;
    await label("Create account").waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("teso_tunes_auth_token")), null);
    assert.deepEqual(errors, [], "No uncaught browser errors");
    console.log(`PASS ${width}x${height} ${url}: Profile cleanup/edit/support/artist access/logout, account hydration, likes/unlikes/rollback, follows/unfollows/Undo/counts, playlist create/reload, Library sections, removals survive reload`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `failure-${width}.png`), fullPage: true });
    console.error((await page.locator("body").innerText()).slice(-5000));
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  if (process.argv.includes("--preview")) {
    console.log(`Local preview: http://127.0.0.1:${server.address().port}/library`);
    return;
  }
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
    for (const [width, height] of [[360, 800], [320, 568], [1280, 900]]) await verify(browser, width, height);
    console.log(`Screenshots: ${artifacts}`);
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
