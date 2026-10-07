// Explicitly opt in: creates/deletes only named test playlists, never catalog or engagement data.
const assert = require("node:assert/strict");
const serve = require("./pwa-test-server.cjs");
const api = "https://teso-music-app.onrender.com/api";
const created = new Set();
const sessions = new Set();
const responseJobs = [];
let token;
function safeError(error) {
  let message = String(error?.message || "Verification failed");
  for (const secret of [process.env.TESO_TEST_EMAIL, process.env.TESO_TEST_PASSWORD, ...sessions]) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message;
}
async function request(path, method = "GET", body, session = token) {
  const response = await fetch(`${api}${path}`, {
    method, headers: { ...(session ? { Authorization: `Bearer ${session}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
(async () => {
  assert.ok(process.argv.includes("--live"), "Use --live only for authorized isolated playlist checks");
  assert.ok(process.env.TESO_TEST_EMAIL && process.env.TESO_TEST_PASSWORD, "Test-account environment variables are required");
  const { server, url } = process.env.VERIFY_BASE_URL ? { server: { close() {} }, url: process.env.VERIFY_BASE_URL } : await serve(process.argv[2]);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  let browser, context;
  try {
    const login = await request("/auth/login/", "POST", { identifier: process.env.TESO_TEST_EMAIL, password: process.env.TESO_TEST_PASSWORD, device_name: "Isolated playlist parity verification" }, null);
    token = login.token; sessions.add(token);
    const me = await request("/auth/me/"); assert.equal(me.listener.id, login.listener.id);
    const original = await request("/playlists/");
    const songs = await request("/songs/"); assert.ok(songs.length);
    browser = await chromium.launch({ channel: "msedge", headless: true });
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await context.addInitScript(() => localStorage.setItem("tesohub_music_onboarding_v1", "completed"));
    const page = await context.newPage();
    // Record successful creations immediately, including if a later UI assertion fails.
    page.on("response", response => {
      if (response.url().endsWith("/api/playlists/") && response.request().method() === "POST" && response.ok()) {
        responseJobs.push(response.json().then(item => created.add(item.id)));
      }
    });
    await page.goto(`${url}/profile`);
    await page.getByText("Log In", { exact: true }).click();
    await page.getByPlaceholder("Email or phone").fill(process.env.TESO_TEST_EMAIL);
    await page.getByPlaceholder("Password").fill(process.env.TESO_TEST_PASSWORD);
    const loggedIn = page.waitForResponse(r => r.url().endsWith("/auth/login/") && r.ok(), { timeout: 60000 });
    await page.getByLabel("Login", { exact: true }).click();
    sessions.add((await (await loggedIn).json()).token);
    await page.waitForURL(url + "/", { timeout: 60000 });
    console.log("PASS real PWA listener login and authenticated /auth/me");

    const name = `PWA parity test ${Date.now()}`;
    await page.goto(`${url}/create`);
    const input = page.getByPlaceholder("My Teso Mix");
    await input.tap(); assert.equal(await input.evaluate(e => e === document.activeElement), true);
    await input.fill(name);
    await input.press("Enter");
    await page.waitForURL(/\/playlist\/\d+$/, { timeout: 60000 });
    const id = Number(new URL(page.url()).pathname.split("/").pop()); created.add(id);
    const fromOtherSession = await request(`/playlists/${id}/`); assert.equal(fromOtherSession.name, name);
    assert.equal((await request("/playlists/")).find(p => p.id === id).song_count, 0);
    console.log("PASS touch PWA creation persists and is visible to a separate account session (Android API contract)");

    await page.getByLabel("Add songs to playlist", { exact: true }).click();
    const addResponse = page.waitForResponse(r => r.url().endsWith(`/playlists/${id}/songs/`) && r.request().method() === "POST", { timeout: 60000 });
    await page.getByText(songs[0].title, { exact: true }).filter({ visible: true }).last().click();
    assert.equal((await addResponse).ok(), true);
    await page.getByLabel("Close song picker", { exact: true }).click();
    assert.equal((await request(`/playlists/${id}/`)).songs.some(s => s.id === songs[0].id), true);
    await request(`/playlists/${id}/songs/${songs[0].id}/`, "DELETE");
    await page.reload(); await page.getByText("No songs yet", { exact: true }).waitFor({ timeout: 60000 });
    await request(`/playlists/${id}/songs/`, "POST", { song_id: songs[0].id });
    await page.reload();
    const removed = page.waitForResponse(r => r.url().endsWith(`/playlists/${id}/songs/${songs[0].id}/`) && r.request().method() === "DELETE", { timeout: 60000 });
    await page.getByLabel("Remove song from playlist", { exact: true }).click();
    assert.equal((await removed).ok(), true);
    assert.equal((await request(`/playlists/${id}/`)).songs.length, 0);
    await page.getByLabel("Rename playlist", { exact: true }).click();
    await page.getByPlaceholder("Playlist name").fill(`${name} renamed`);
    const renamed = page.waitForResponse(r => r.url().endsWith(`/playlists/${id}/`) && r.request().method() === "PUT");
    await page.getByText("Save", { exact: true }).click(); assert.equal((await renamed).ok(), true);
    assert.equal((await request(`/playlists/${id}/`)).name, `${name} renamed`);
    await page.getByLabel("Rename playlist", { exact: true }).click();
    page.once("dialog", dialog => dialog.accept());
    const deleted = page.waitForResponse(r => r.url().endsWith(`/playlists/${id}/`) && r.request().method() === "DELETE");
    await page.getByText("Delete", { exact: true }).click(); assert.equal((await deleted).ok(), true);
    created.delete(id);
    console.log("PASS real PWA add/remove/rename/delete; changes reconcile in both independent sessions");

    const other = await request("/playlists/", "POST", { name: `${name} second session` }); created.add(other.id);
    await page.goto(`${url}/playlist/${other.id}`); await page.getByText(other.name, { exact: true }).waitFor({ timeout: 60000 });
    await request(`/playlists/${other.id}/`, "DELETE"); created.delete(other.id);
    const remaining = await request("/playlists/");
    assert.deepEqual(remaining, original);
    console.log("PASS second-session creation opens in PWA by ID; only isolated test playlists removed; original playlists unchanged");
    await Promise.all(responseJobs);
    // Response tracking includes the playlist already deleted above.
    for (const id of [...created]) if (!remaining.some(p => p.id === id)) created.delete(id);
  } finally {
    await Promise.all(responseJobs);
    for (const id of created) {
      const current = await fetch(`${api}/playlists/${id}/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
      if (current.status === 404) continue;
      try { await request(`/playlists/${id}/`, "DELETE"); console.log(`Cleaned up temporary playlist ${id}`); }
      catch (error) { console.error(`CLEANUP REQUIRED: temporary playlist ${id}: ${error.message}`); process.exitCode = 1; }
    }
    for (const session of sessions) {
      try { await request("/auth/logout/", "POST", undefined, session); }
      catch { console.error("Could not revoke one test-created session"); process.exitCode = 1; }
    }
    await context?.close(); await browser?.close(); server.close();
  }
})().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
