import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = fs.readFileSync(new URL("../supabasePersistence.js", import.meta.url), "utf8");
const start = source.indexOf("  function playlistFromRow(");
const end = source.indexOf("  function supportAttachmentFromRow", start);
const serialize = vm.runInNewContext(`${source.slice(start, end)}; playlistFromRow`, {
  toIso: value => value || null, buckets: { artwork: "artwork" }, storageUrlFor: (_, value) => value,
});

test("empty playlist summaries preserve zero without dereferencing omitted songs", () => {
  for (const song_count of [0, "0", null, undefined]) {
    const item = serialize({ id: 7, owner_id: 3, song_count }, null);
    assert.equal(item.song_count, 0);
    assert.equal("songs" in item, false);
  }
  assert.equal(serialize({ id: 7, owner_id: 3, song_count: 0 }, [{ id: 1 }]).song_count, 0);
  assert.equal(serialize({ id: 7, owner_id: 3 }, [{ id: 1 }]).song_count, 1);
  assert.equal(serialize({ id: 7, owner_id: 3, song_count: 2 }, null).song_count, 2);
});

test("zero playlists and mixed empty/nonempty summaries retain the owner filter", async () => {
  const start = source.indexOf("  async function listPlaylists(");
  const end = source.indexOf("  async function getPlaylist(", start);
  let rows = [];
  const list = vm.runInNewContext(`${source.slice(start, end)}; listPlaylists`, {
    playlistFromRow: serialize,
    getPool: () => ({ query: async (sql, params) => {
      assert.match(sql, /where playlist.owner_id = \$1/);
      assert.equal(params[0], 3);
      return { rows };
    } }),
  });
  assert.equal((await list(3)).length, 0);
  rows = [{ id: 7, owner_id: 3, song_count: 0 }, { id: 8, owner_id: 3, song_count: 2 }];
  const result = await list(3);
  assert.equal(result[0].song_count, 0);
  assert.equal(result[1].song_count, 2);
});
