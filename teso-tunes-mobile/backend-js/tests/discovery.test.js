import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { discoveryOptions, discoverySql, selectDiscovery } from "../discovery.js";

test("bounded options validate IDs and preserve legacy requests", () => {
  assert.deepEqual(discoveryOptions({ search: "music" }), {});
  assert.deepEqual(discoveryOptions({ limit: "900", ids: "1,1,2,x,0,-2,1e3,9007199254740993" }), { limit: 50, discovery: "more", ids: [1, 2] });
  assert.equal(discoveryOptions({ limit: "-5" }).limit, 1);
  assert.deepEqual(discoveryOptions({ ids: "invalid" }).ids, []);
});

const songs = [
  { id: 1, status: "published", release_date: "2026-01-01", play_count: 20 },
  { id: 2, status: "published", release_date: "2026-06-01", play_count: 4, is_featured: true },
  { id: 3, status: "published", release_date: "2099-01-01", play_count: 0 },
  { id: 4, status: "draft", release_date: "2026-06-02", play_count: 999, is_featured: true },
  { id: 5, status: "published", release_date: null, play_count: 0 },
];
test("new music uses real past release dates; popular uses positive cumulative plays", () => {
  assert.deepEqual(selectDiscovery(songs, discoveryOptions({ discovery: "new" }), "song", "2026-10-03").map(s => s.id), [2, 1]);
  assert.deepEqual(selectDiscovery(songs, discoveryOptions({ discovery: "popular" })).map(s => s.id), [1, 2]);
  assert.deepEqual(selectDiscovery(songs, discoveryOptions({ discovery: "featured" })).map(s => s.id), [2]);
  assert.deepEqual(selectDiscovery(songs, discoveryOptions({ ids: "4,5" })).map(s => s.id), [5]);
  assert.deepEqual(selectDiscovery(songs, discoveryOptions({ ids: "invalid" })), []);
  assert.equal(selectDiscovery(songs, {}), songs);
});

test("SQL values are parameterized, bounded and strictly published", () => {
  const params = ["existing-search"];
  const sql = discoverySql(discoveryOptions({ discovery: "new", limit: "6", ids: "1,2" }), params);
  assert.deepEqual(params, ["existing-search", [1, 2], 6]);
  assert.ok(sql.filters.includes("song.status = 'published'"));
  assert.ok(sql.filters.includes("song.id = any($2::bigint[])"));
  assert.equal(sql.limit, "limit $3");
  assert.equal(sql.order, "song.release_date desc, song.id desc");
  assert.deepEqual(discoverySql({}, []), { filters: [], order: "", limit: "" });
});

test("Supabase list queries apply projection in SQL, not after full-catalog transfer", async () => {
  const source = fs.readFileSync(new URL("../supabasePersistence.js", import.meta.url), "utf8");
  for (const [name, next, kind] of [["listPublicSongs", "getPublicSong", "song"], ["listPublicArtists", "getPublicArtist", "artist"]]) {
    const start = source.indexOf(`  async function ${name}(`);
    const end = source.indexOf(`  async function ${next}(`, start);
    const calls = [];
    const ctx = { discoverySql, publishDueReleases: async () => {}, getPool: () => ({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } }), publicSongFromRow: row => row, publicArtistFromRow: row => row };
    vm.createContext(ctx);
    vm.runInContext(source.slice(start, end), ctx);
    await ctx[name]({ category: "test", search: "song", ...discoveryOptions({ discovery: "featured", limit: "8" }) });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /limit \$3/);
    assert.ok(calls[0].sql.includes(`${kind}.is_featured = true`));
    assert.equal(calls[0].params[2], 8);
    if (kind === "song") assert.ok(calls[0].sql.includes("song.status = 'published'"));
  }
});

test("existing public API array responses stay compatible and never fall back in Supabase mode", async () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  for (const kind of ["songs", "artists"]) {
    const start = source.indexOf(`app.get("/api/${kind}/",`);
    const end = source.indexOf("\n});", start) + 4;
    let handler, options;
    vm.runInNewContext(source.slice(start, end), {
      app: { get: (_, fn) => { handler = fn; } }, discoveryOptions, USE_SUPABASE_PERSISTENCE: true,
      supabasePersistence: { [kind === "songs" ? "listPublicSongs" : "listPublicArtists"]: async opts => { options = opts; return [{ id: 1 }]; } },
      directSongResponse: (_, item) => item, directArtistResponse: (_, item) => item,
      loadDbWithPublishedReleases: () => { throw new Error("No JSON reads allowed"); },
    });
    let result;
    await handler({ query: { limit: "8", discovery: "featured" } }, { json: value => { result = value; } });
    assert.equal(options.limit, 8);
    assert.equal(options.discovery, "featured");
    assert.equal(JSON.stringify(result), '[{"id":1}]');
    await handler({ query: {} }, { json() {} });
    assert.equal(options.limit, undefined);
  }
});

test("public genres use one small read, preserving Admin active flag and order", async () => {
  const source = fs.readFileSync(new URL("../supabasePersistence.js", import.meta.url), "utf8");
  const start = source.indexOf("  async function listPublicGenres()");
  const end = source.indexOf("  async function platformSettings()", start);
  let query;
  const ctx = vm.createContext({ getPool: () => ({ query: async sql => { query = sql; return { rows: [{ name: "Akogo" }] }; } }) });
  vm.runInContext(source.slice(start, end), ctx);
  assert.equal(JSON.stringify(await ctx.listPublicGenres()), '["Akogo"]');
  assert.match(query, /where active = true order by position, name/);
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const routeStart = server.indexOf('app.get("/api/genres/",');
  let handler;
  vm.runInNewContext(server.slice(routeStart, server.indexOf("\n});", routeStart) + 4), {
    app: { get: (_, fn) => { handler = fn; } }, USE_SUPABASE_PERSISTENCE: true,
    supabasePersistence: { listPublicGenres: async () => ["Akogo"] },
    loadDb: () => { throw new Error("Full persistence read forbidden"); },
  });
  await handler({}, { json: value => assert.deepEqual(value, ["Akogo"]) });
});
