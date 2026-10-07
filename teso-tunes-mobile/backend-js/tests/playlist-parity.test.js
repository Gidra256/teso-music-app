import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { renderPublicSongPage } from "../songSharing.js";

const persistence = fs.readFileSync(new URL("../supabasePersistence.js", import.meta.url), "utf8");
const from = persistence.indexOf("  function playlistFromRow(");
const to = persistence.indexOf("  function supportAttachmentFromRow", from);
const serializer = vm.runInNewContext(`${persistence.slice(from, to)}; playlistFromRow`, { toIso: value => value || null, buckets: { artwork: "artwork" }, storageUrlFor: (_, path) => path });
test("empty playlist summaries do not throw for null songs; authoritative zero wins", () => {
  for (const count of [0, "0", null, undefined]) {
    const result = serializer({ id: "7", owner_id: "3", name: "Empty", song_count: count }, null);
    assert.equal(result.song_count, 0);
    assert.equal("songs" in result, false);
  }
  assert.equal(serializer({ id: 7, owner_id: 3, song_count: 0 }, [{ id: 1 }]).song_count, 0);
  assert.equal(serializer({ id: 7, owner_id: 3 }, [{ id: 1 }]).song_count, 1);
});
test("Supabase playlist listing preserves ownership and counts without fetching songs", async () => {
  const start = persistence.indexOf("  async function listPlaylists(");
  const end = persistence.indexOf("  async function getPlaylist(", start);
  let values;
  const list = vm.runInNewContext(`${persistence.slice(start, end)}; listPlaylists`, {
    playlistFromRow: serializer,
    getPool: () => ({ query: async (sql, params) => {
      assert.match(sql, /where playlist.owner_id = \$1/); values = params;
      return { rows: [{ id: 7, owner_id: 3, song_count: 0 }, { id: 8, owner_id: 3, song_count: 2 }] };
    } }),
  });
  const result = await list(3);
  assert.equal(values[0], 3); assert.equal(result.length, 2);
  assert.equal(result[0].song_count, 0); assert.equal(result[1].song_count, 2);
});
test("legacy artist and playlist links redirect to exact PWA paths with validated IDs", () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const start = source.indexOf('app.get(["/artist/:id", "/playlist/:id"]');
  let handler;
  vm.runInNewContext(source.slice(start, source.indexOf("\n});", start) + 4), {
    app: { get: (_, fn) => { handler = fn; } }, PUBLIC_MUSIC_WEB_URL: "https://web.example.test",
  });
  for (const kind of ["artist", "playlist"]) {
    let target;
    handler({ params: { id: "37" }, path: `/${kind}/37` }, { set() {}, redirect: (status, url) => { assert.equal(status, 302); target = url; } });
    assert.equal(target, `https://web.example.test/${kind}/37`);
  }
  handler({ params: { id: "invalid" } }, { sendStatus: status => assert.equal(status, 404) });
});
test("song landing keeps metadata and routes Android to exact app content with web fallback", () => {
  const config = { shareBaseUrl: "https://api.example.test", webBaseUrl: "https://web.example.test", assetBaseUrl: "https://api.example.test" };
  const song = { id: 37, status: "published", title: "Song" };
  const html = renderPublicSongPage(song, config);
  assert.ok(html.includes("intent://song/37#Intent;scheme=tesohubmusic;package=com.tesotunes.app"));
  assert.ok(html.includes(encodeURIComponent("https://web.example.test/song/37?app_fallback=1")));
  assert.ok(!html.includes("Get Android App"));
  assert.ok(renderPublicSongPage(song, { ...config, androidDownloadUrl: "https://downloads.example.test/app.apk" }).includes("Get Android App"));
  assert.ok(!renderPublicSongPage(song, { ...config, androidDownloadUrl: "javascript:alert(1)" }).includes("Get Android App"));
});
