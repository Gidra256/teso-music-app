const assert = require("node:assert/strict");
const api = "https://teso-music-app.onrender.com";
let token, temporaryId;
async function call(path, method = "GET", body) {
  const response = await fetch(api + path, { method, signal: AbortSignal.timeout(60000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
(async () => {
  assert.ok(process.env.TESO_TEST_EMAIL && process.env.TESO_TEST_PASSWORD, "Test listener credentials required");
  try {
    const login = await call("/api/auth/login/", "POST", { identifier: process.env.TESO_TEST_EMAIL, password: process.env.TESO_TEST_PASSWORD, device_name: "Playlist deployment gate" });
    token = login.token;
    const original = await call("/api/playlists/");
    assert.ok(Array.isArray(original));
    if (process.argv.includes("--empty-only")) {
      assert.equal(original.length, 0, "Current test account is not empty; existing playlists were left untouched");
      console.log("PASS authenticated zero-playlist account: HTTP 200, []");
      return;
    }
    console.log(original.length === 0 ? "PASS authenticated zero-playlist account: HTTP 200, []" : "Existing playlists preserved; zero-playlist account check requires a separate empty test account");
    const item = await call("/api/playlists/", "POST", { name: `Deployment gate ${Date.now()}` });
    temporaryId = item.id;
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const playlists = await call("/api/playlists/");
        assert.equal(playlists.find(p => p.id === temporaryId)?.song_count, 0);
        ready = true; break;
      } catch (error) {
        if (!error.message.includes("HTTP 500")) throw error;
        console.log(`Waiting for backend fix (${attempt + 1}/20): empty-playlist listing still HTTP 500`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
    assert.ok(ready, "Render has not served the playlist fix within the verification window");
    console.log("PASS production empty-playlist serialization: HTTP 200, authoritative song_count 0");
    const songs = await call("/api/songs/"); assert.ok(songs.length);
    await call(`/api/playlists/${temporaryId}/songs/`, "POST", { song_id: songs[0].id });
    assert.equal((await call("/api/playlists/")).find(p => p.id === temporaryId).song_count, 1);
    await call(`/api/playlists/${temporaryId}/songs/${songs[0].id}/`, "DELETE");
    assert.equal((await call("/api/playlists/")).find(p => p.id === temporaryId).song_count, 0);
    const renamed = await call(`/api/playlists/${temporaryId}/`, "PUT", { name: `${item.name} renamed` });
    assert.equal(renamed.name, `${item.name} renamed`);
    await call(`/api/playlists/${temporaryId}/`, "DELETE"); temporaryId = null;
    assert.deepEqual(await call("/api/playlists/"), original);
    assert.equal((await call("/healthz")).persistence_backend, "supabase");
    console.log("PASS create/add/remove/rename/delete, original playlists unchanged, healthz Supabase");
  } finally {
    try {
      if (temporaryId) await call(`/api/playlists/${temporaryId}/`, "DELETE");
    } finally { if (token) await call("/api/auth/logout/", "POST"); }
  }
})().catch(error => { console.error(error.message.replaceAll(process.env.TESO_TEST_PASSWORD || "unused-redaction-value", "[redacted]")); process.exitCode = 1; });
