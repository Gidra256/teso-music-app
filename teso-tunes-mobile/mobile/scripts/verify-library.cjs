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
  let failNextFollow = false;
  let displayName = "Library Tester";
  let role = "listener";
  const songs = [1, 2].map(id => ({ id, title: `Test Song ${id}`, artist: 11, artist_name: "Test Artist", genre: "Test", like_count: 3, cover_image: "", audio_file: "", duration: 120 }));
  const artist = { id: 11, name: "Test Artist", category: "Test", photo: "", follower_count: 10, songs };
  const playlists = [{ id: 21, name: "Test Mix", song_count: 1, songs: [songs[0]] }];
  let supportTicket = null;
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
    if (endpoint === '/auth/login/' || endpoint === '/auth/register/') {
      await new Promise(resolve => setTimeout(resolve, 350));
      return send({ token: 'test-only-token', listener: account() });
    }
    if (endpoint === "/support/help-center/") return send({ categories: { listener: ['Playback'], artist: ['Upload Problem'] }, articles: [] });
    if (endpoint === '/support/tickets/' && method === 'POST') {
      await new Promise(resolve => setTimeout(resolve, 350));
      supportTicket = { id: 51, reference: 'SUP-0051', subject: 'Playback check', category: 'Playback', priority: 'normal', status: 'open', messages: [{ id: 1, author_type: 'user', message: 'Please check playback on my phone.' }] };
      return send(supportTicket, 201);
    }
    if (endpoint === '/support/tickets/') return send(supportTicket ? [supportTicket] : []);
    if (endpoint === '/support/tickets/51/') return send(supportTicket);
    if (endpoint === '/support/tickets/51/replies/') {
      await new Promise(resolve => setTimeout(resolve, 350));
      supportTicket.messages.push({ id: 2, author_type: 'user', message: 'Thank you for checking.' });
      return send(supportTicket);
    }
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
      await new Promise(resolve => setTimeout(resolve, 350));
      if (failNextFollow) { failNextFollow = false; return send({ detail: "Test network failure" }, 503); }
      if (follow[1] === "follow") follows.add(11);
      else follows.delete(11);
      return send({ followed: follows.has(11), follower_count: follows.has(11) ? 10 : 9 });
    }
    if (endpoint === "/playlists/" && method === "POST") {
      await new Promise(resolve => setTimeout(resolve, 350));
      const item = { ...request.postDataJSON(), id: 22, song_count: 0, songs: [] };
      playlists.push(item);
      return send(item, 201);
    }
    if (endpoint === "/playlists/") return send(playlists);
    const playlist = endpoint.match(/^\/playlists\/(\d+)\/$/);
    if (playlist) {
      const item = playlists.find(item => item.id === Number(playlist[1]));
      if (method === "PUT") Object.assign(item, request.postDataJSON());
      if (method === "DELETE") { playlists.splice(playlists.indexOf(item), 1); return send({}); }
      return send(item);
    }
    const playlistSong = endpoint.match(/^\/playlists\/(\d+)\/songs\/(\d+\/)?$/);
    if (playlistSong) {
      await new Promise(resolve => setTimeout(resolve, 350));
      const item = playlists.find(item => item.id === Number(playlistSong[1]));
      const id = method === "POST" ? request.postDataJSON().song_id : Number(playlistSong[2].replace('/', ''));
      item.songs = method === "POST" ? [...item.songs.filter(song => song.id !== id), songs.find(song => song.id === id)] : item.songs.filter(song => song.id !== id);
      item.song_count = item.songs.length;
      return send({ playlist: item });
    }
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
    await label("Log out").waitFor();
    assert.equal(await text("Liked songs").count(), 0);
    assert.equal(await text("Following artists").count(), 0);
    assert.equal(await text("Following").count(), 0);
    assert.equal(await text("Taste").count(), 0);
    assert.equal(calls.some(call => /GET \/(songs|artists)\//.test(call)), false, "Profile must not fetch catalogs");
    await page.screenshot({ path: path.join(artifacts, `profile-${width}.png`), fullPage: true });
    await label("Edit Profile").click();
    await page.getByPlaceholder("Profile name").fill("Edited Tester");
    const saved = page.waitForResponse(r => r.url().endsWith("/auth/me/") && r.request().method() === "PUT");
    await label("Save Changes").click();
    await saved;
    assert.equal(displayName, "Edited Tester");
    await text("Profile saved.").waitFor();
    await label("Back").click();
    await label("Open Help and Support").click();
    await text("Get Help").waitFor();
    await text("My Support Requests").click();
    await text("No support requests yet").waitFor();
    await page.goto(`${url}/support/new`);
    await page.getByPlaceholder('Subject').fill('Playback check');
    await page.getByPlaceholder('Tell us what happened').fill('Please check playback on my phone.');
    await text('Submit a Support Request').last().evaluate(el => { el.click(); el.click(); });
    await text('Request #TSH-0051').waitFor();
    assert.equal(calls.filter(call => call === 'POST /support/tickets/').length, 1);
    await page.getByPlaceholder('Write your reply').fill('Thank you for checking.');
    await text('Send Reply').evaluate(el => { el.click(); el.click(); });
    await text('Thank you for checking.').waitFor();
    assert.equal(calls.filter(call => call === 'POST /support/tickets/51/replies/').length, 1);
    await page.goto(`${url}/profile`);
    await text("Become an Artist").waitFor();
    await label("Open Artist Application").click();
    await text("Artist application").waitFor();
    role = "artist";
    await page.goto(`${url}/profile`);
    await text("Artist Studio").last().waitFor();
    await label("Open Artist Studio").click();
    await page.waitForURL("**/artist-studio");
    await text("Test Artist").waitFor();
    role = "listener";

    await page.goto(`${url}/library`);
    await text("Test Mix").waitFor();
    await tab("Liked Songs").click();
    await text("Test Song 1").waitFor();
    assert.equal(await text("Test Song 2").count(), 0, "Server replaces stale cached likes");
    const unlikeResponse = page.waitForResponse(r => r.url().endsWith("/songs/1/unlike/"));
    await label("Unlike Test Song 1").evaluate(el => { el.click(); el.click(); });
    await text("Test Song 1").waitFor({ state: "hidden" });
    await unlikeResponse;
    assert.equal(calls.filter(call => call === 'POST /songs/1/unlike/').length, 1, 'Rapid unlike makes one request');
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
    await text("Could not update this like. Please try again.").waitFor();
    await label("Dismiss message").click();
    await tab("Liked Songs").click();
    await text("Test Song 1").waitFor();
    assert.equal(await text("Test Song 2").count(), 0, "Failed like rolls back");

    await tab("Following Artists").click();
    await text("Test Artist").waitFor();
    await text("10 followers").waitFor();
    await text("Test Artist").click();
    await text("Following").evaluate(el => { el.click(); el.click(); });
    await text("9 followers").waitFor();
    const undoResponse = page.waitForResponse(r => r.url().endsWith('/artists/11/follow/'));
    await text("UNDO").click();
    await text("10 followers").waitFor();
    await undoResponse;
    assert.equal(calls.filter(call => call === 'POST /artists/11/unfollow/').length, 1, 'Rapid unfollow makes one request');
    await page.goBack();
    await text("Test Artist").waitFor();
    const unfollowResponse = page.waitForResponse(r => r.url().endsWith('/artists/11/unfollow/'));
    await text("Following").click();
    await text("No followed artists yet").waitFor();
    await unfollowResponse;
    assert.equal(follows.size, 0);
    await page.reload();
    await text("Test Mix").waitFor();
    await tab("Following Artists").click();
    await text("No followed artists yet").waitFor();

    await page.goto(`${url}/artists`);
    failNextFollow = true;
    await text("Follow").evaluate(el => { el.click(); el.click(); });
    await text("Could not follow this artist. Please try again.").waitFor();
    await text("Follow").waitFor();
    await label("Dismiss message").click();
    const followResponse = page.waitForResponse(r => r.url().endsWith('/artists/11/follow/'));
    await text("Follow").click();
    await text("Following").waitFor();
    await text("10 followers").waitFor();
    await followResponse;
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
    await text("Create Playlist").evaluate(el => { el.click(); el.click(); });
    await text("Created Mix").waitFor();
    assert.equal(calls.filter(call => call === 'POST /playlists/').length, 1, 'Rapid create makes one request');
    await label("Add songs to playlist").click();
    const addedResponse = page.waitForResponse(r => r.url().endsWith('/playlists/22/songs/'));
    await text("Test Song 2").evaluate(el => { el.click(); el.click(); });
    await addedResponse;
    await label("Close song picker").click();
    await text("Test Song 2").waitFor();
    assert.equal(calls.filter(call => call === 'POST /playlists/22/songs/').length, 1);
    await label("Remove song from playlist").evaluate(el => { el.click(); el.click(); });
    await text("No songs yet").waitFor();
    assert.equal(calls.filter(call => call === 'DELETE /playlists/22/songs/2/').length, 1);
    await label("Rename playlist").click();
    await page.getByPlaceholder("Playlist name").fill("Renamed Mix");
    await text("Save").evaluate(el => { el.click(); el.click(); });
    await text("Renamed Mix").waitFor();
    assert.equal(calls.filter(call => call === 'PUT /playlists/22/').length, 1);
    await label("Rename playlist").click();
    page.removeAllListeners('dialog'); page.once('dialog', dialog => dialog.accept());
    await text("Delete").click();
    await page.waitForURL('**/library');
    assert.equal(playlists.some(item => item.id === 22), false);
    assert.equal(await text("Renamed Mix").count(), 0);
    await page.goto(`${url}/library`);
    await text("Test Mix").waitFor();
    await tab("Liked Songs").click();
    await text("Test Song 1").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.goto(`${url}/profile`);
    await text("Edited Tester").waitFor();
    const loggedOut = page.waitForResponse(r => r.url().endsWith("/auth/logout/"));
    await label("Log out").click();
    await loggedOut;
    await text("Create Account").waitFor();
    assert.equal(await text("Welcome to TesoHub Music").count(), 0);
    await text("Keep Listening").click();
    await text("All").waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("teso_tunes_auth_token")), null);
    await page.goto(`${url}/profile`);
    await text('Log In').click();
    await page.getByPlaceholder('Email or phone').fill('library@example.test');
    await page.getByPlaceholder('Password').fill('Fixture-password-only');
    await label('Login').evaluate(el => { el.click(); el.click(); });
    await page.waitForURL(url + '/');
    assert.equal(calls.filter(call => call === 'POST /auth/login/').length, 1);
    await page.goto(`${url}/profile`);
    await label('Log out').click();
    await text('Create Account').click();
    await page.getByPlaceholder('Profile name').fill('Fixture Listener');
    await page.getByPlaceholder('Email', { exact: true }).fill('fixture@example.test');
    await page.getByPlaceholder('Password').fill('Fixture-password-only');
    await label('Create account').evaluate(el => { el.click(); el.click(); });
    await page.waitForURL(url + '/');
    assert.equal(calls.filter(call => call === 'POST /auth/register/').length, 1);
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
