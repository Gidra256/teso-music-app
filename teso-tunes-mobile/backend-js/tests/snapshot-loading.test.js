import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = fs.readFileSync(new URL("../supabasePersistence.js", import.meta.url), "utf8");
const start = source.indexOf("  async function loadDb()");
const end = source.indexOf("  async function listPublicArtists", start);

function loader(queryRows) {
  return vm.runInNewContext(`${source.slice(start, end)}; loadDb`, {
    getPool: () => ({}), queryRows, toIso: value => value,
    listenerFromRow: row => row, artistFromRow: row => row,
    applicationFromRow: row => row, songFromRow: row => row, releaseFromRow: row => row,
  });
}

test("snapshot reads preserve pending applications and ordering with one outstanding query", async () => {
  const calls = [];
  let active = 0;
  let peak = 0;
  const pending = { id: 1, listener: 6, status: "pending" };
  const load = loader(async (_, table, order) => {
    calls.push([table, order]); peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return table === "artist_applications" ? [pending] : [];
  });
  const db = await load();
  assert.equal(peak, 1);
  assert.equal(calls.length, 15);
  assert.equal(db.artistApplications[0], pending);
  assert.ok(calls.some(([table, order]) => table === "playlist_songs" && order === "playlist_id, position, id"));
  assert.ok(calls.some(([table, order]) => table === "feature_flags" && order === "key"));
});

test("a failed table read rejects the snapshot and stops scheduling further reads", async () => {
  const calls = [];
  const failure = new Error("Connection unavailable");
  const load = loader(async (_, table) => {
    calls.push(table);
    if (table === "artist_applications") throw failure;
    return [];
  });
  await assert.rejects(load(), error => error === failure);
  assert.deepEqual(calls, ["listeners", "artists", "genres", "artist_applications"]);
});

test("fourteen concurrent snapshots do not flood a single-connection pool", async () => {
  let outstanding = 0;
  let peak = 0;
  let tail = Promise.resolve();
  const load = loader(async () => {
    peak = Math.max(peak, ++outstanding);
    assert.ok(outstanding <= 14, "each request may queue only its next table read");
    const job = tail.then(() => new Promise(resolve => setImmediate(resolve)));
    tail = job;
    await job;
    outstanding--;
    return [];
  });
  const snapshots = await Promise.all(Array.from({ length: 14 }, () => load()));
  assert.equal(snapshots.length, 14);
  assert.equal(peak, 14);
  assert.equal(outstanding, 0);
});
