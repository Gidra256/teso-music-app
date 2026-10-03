import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { isShareableSong, renderPublicSongPage } from "../songSharing.js";

const song = { id: 37, status: "published", title: 'Song <script>" &', artist_name: "Artist", cover_image: "/artwork.jpg", audio_file: "PRIVATE-AUDIO-SECRET" };
const config = { shareBaseUrl: "https://api.example.test", webBaseUrl: "https://web.example.test", assetBaseUrl: "https://api.example.test" };

test("metadata is escaped and links to the exact public song without audio", () => {
  const html = renderPublicSongPage(song, config);
  assert.ok(html.includes('property="og:title" content="Song &lt;script&gt;&quot; &amp;"'));
  assert.ok(html.includes('href="https://web.example.test/song/37"'));
  assert.ok(html.includes('href="tesohubmusic://song/37"'));
  assert.ok(html.includes('property="og:url" content="https://api.example.test/song/37"'));
  assert.ok(!html.includes("PRIVATE-AUDIO-SECRET"));
  assert.ok(!html.includes("<script>"));
});

test("only published public identifiers are shareable", () => {
  for (const status of ["hidden", "removed", "draft", "under_review", undefined]) {
    assert.equal(isShareableSong({ ...song, status }), false);
    assert.throws(() => renderPublicSongPage({ ...song, status }, config));
  }
  for (const id of [0, -1, "1e2", "9007199254740993", "37/private", null]) assert.equal(isShareableSong({ ...song, id }), false);
});

test("artwork cannot inject private storage URLs or scripts", () => {
  for (const cover_image of ["javascript:alert(1)", "https://storage.test/music-audio/private.mp3", "https://storage.test/object/sign/artwork/private.png", "https://storage.test/image?token=PRIVATE"]) {
    const html = renderPublicSongPage({ ...song, cover_image }, config);
    assert.ok(html.includes("/app-assets/images/tesohub-music.png"));
    assert.ok(!html.includes(cover_image));
  }
});

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
function handlerFor(route, getPublicSong) {
  const start = server.indexOf(`app.get("${route}",`);
  const end = server.indexOf("\n});", start) + 4;
  let handler;
  vm.runInNewContext(server.slice(start, end), {
    app: { get: (_path, fn) => { handler = fn; } },
    USE_SUPABASE_PERSISTENCE: true,
    supabasePersistence: { getPublicSong },
    loadDbWithPublishedReleases: () => { throw new Error("JSON fallback must never run"); },
    isShareableSong, renderPublicSongPage,
    renderUnavailableSongPage: () => "Song unavailable",
    publicShareBaseUrl: () => config.shareBaseUrl,
    PUBLIC_MUSIC_WEB_URL: config.webBaseUrl,
    PUBLIC_BASE_URL: config.assetBaseUrl,
    directSongResponse: (_req, item) => item,
    trackProductEvent: () => {}, console: { error: () => {} },
  });
  return async (id = "37") => {
    const response = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(value) { this.code = value; return this; }, type() { return this; }, send(value) { this.body = value; return this; }, json(value) { this.body = value; return this; } };
    await handler({ params: { id } }, response);
    return response;
  };
}

test("Supabase landing and song API reject missing, private, and unpublished records", async () => {
  for (const route of ["/song/:id", "/api/songs/:id/"]) {
    for (const item of [null, ...["hidden", "removed", "draft", "under_review"].map(status => ({ ...song, status }))]) {
      const response = await handlerFor(route, async () => item)();
      assert.equal(response.code, 404);
      assert.ok(!JSON.stringify(response.body).includes(song.title));
    }
    const response = await handlerFor(route, async () => song)();
    assert.equal(response.code, 200);
    assert.equal((await handlerFor(route, () => { throw new Error("must not query"); })("invalid")).code, 404);
  }
});

test("Supabase share failure returns 503 without JSON fallback or stale metadata", async () => {
  const response = await handlerFor("/song/:id", async () => { throw new Error("database unavailable"); })();
  assert.equal(response.code, 503);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.body, "Song unavailable");
});
