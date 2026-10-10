import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import {
  adminArtistPage,
  paginateAdminArtists,
  parseAdminArtistListQuery,
} from "../adminArtistPagination.js";
import { createSupabasePersistence } from "../supabasePersistence.js";

const artists = Array.from({ length: 500 }, (_, index) => ({
  id: index + 1,
  name: `Scale Artist ${String((index % 50) + 1).padStart(2, "0")}`,
  category: "Fixture",
  status: index % 3 === 0 ? "suspended" : "active",
  created_at: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
  updated_at: `2026-02-${String((index % 28) + 1).padStart(2, "0")}`,
}));

test("Artist pagination validates defaults, bounds, statuses, sorting and directions", () => {
  assert.deepEqual(parseAdminArtistListQuery({}), {
    page: 1, pageSize: 25, search: "", status: "", sort: "name", direction: "asc",
  });
  assert.equal(parseAdminArtistListQuery({ page_size: "900" }).pageSize, 100);
  for (const query of [
    { page: "0" }, { page: "-1" }, { page: "one" }, { page_size: "0" },
    { status: "unknown" }, { sort: "followers" }, { direction: "sideways" },
    { search: "x".repeat(101) },
  ]) assert.throws(() => parseAdminArtistListQuery(query));
});

test("500-artist JSON compatibility path paginates, filters and orders deterministically", () => {
  const firstOptions = parseAdminArtistListQuery({ page: 1, page_size: 25, sort: "name", direction: "asc" });
  const secondOptions = parseAdminArtistListQuery({ page: 2, page_size: 25, sort: "name", direction: "asc" });
  const first = paginateAdminArtists(artists, firstOptions);
  const second = paginateAdminArtists(artists, secondOptions);
  const response = adminArtistPage(first.rows, firstOptions, first.total);
  assert.equal(response.items.length, 25);
  assert.equal(response.total, 500);
  assert.equal(response.total_pages, 20);
  assert.equal(response.has_next, true);
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, 50);
  assert.deepEqual(
    first.rows.map((row) => row.id),
    [...first.rows].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id).map((row) => row.id),
  );

  const filteredOptions = parseAdminArtistListQuery({ search: "artist 07", status: "active", sort: "id", direction: "desc" });
  const filtered = paginateAdminArtists(artists, filteredOptions);
  assert.ok(filtered.rows.every((row) => row.name.includes("07") && row.status === "active"));
  assert.deepEqual(filtered.rows.map((row) => row.id), [...filtered.rows].map((row) => row.id).sort((a, b) => b - a));

  const emptyOptions = parseAdminArtistListQuery({ search: "missing artist" });
  const empty = adminArtistPage([], emptyOptions, 0);
  assert.deepEqual(empty, {items: [], page: 1, page_size: 25, total: 0, total_pages: 0, has_next: false});
});

test("Supabase Admin artist list performs exactly one count and one bounded list query", async () => {
  const calls = [];
  const fakePool = {
    async query(sql, values = []) {
      calls.push({ sql: String(sql), values });
      if (/count\(\*\)::int as total/.test(sql)) return { rows: [{ total: 500 }] };
      return { rows: Array.from({ length: 25 }, (_, index) => ({
        id: index + 26, name: `Artist ${index + 26}`, category: "Fixture",
        status: "active", is_featured: false, follower_count: 2, stream_count: 10,
      })) };
    },
    async connect() { throw new Error("Unexpected connection acquisition"); },
  };
  const persistence = createSupabasePersistence({
    databaseUrl: "postgresql://fixture", supabaseUrl: "https://fixture.invalid",
    secretKey: "fixture", buckets: {avatars: "avatars"}, storageUrlFor: (bucket, value) => `/${bucket}/${value}`,
    poolFactory: () => fakePool,
  });
  const result = await persistence.listAdminArtists(parseAdminArtistListQuery({ page: 2, page_size: 25, search: " Artist ", status: "active", sort: "updated_at", direction: "desc" }));
  assert.equal(result.total, 500);
  assert.equal(result.rows.length, 25);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /from tesohub_music\.artists/);
  assert.match(calls[1].sql, /limit \$3 offset \$4/);
  assert.deepEqual(calls[1].values.slice(-2), [25, 25]);
  const combined = calls.map((call) => call.sql).join("\n");
  for (const unrelated of ["listeners", "releases", "song_likes", "playlists", "admin_sessions", "support_tickets", "admin_audit_logs"]) {
    assert.doesNotMatch(combined, new RegExp(`tesohub_music\\.${unrelated}`));
  }
  assert.match(combined, /artist_follows/);
  assert.match(combined, /tesohub_music\.songs/);
});

test("Admin artist detail returns edit fields without persistence ownership fields", async () => {
  const calls = [];
  const fakePool = {
    async query(sql, values) {
      calls.push({sql:String(sql),values});
      return {rows:[{
        id:7,name:"Detail Artist",category:"Gospel Artists",bio:"Bio",photo_path:"artist.jpg",
        location:"Teso",is_featured:true,status:"active",created_at:"2026-01-01T00:00:00Z",
        updated_at:"2026-02-01T00:00:00Z",follower_count:4,stream_count:90,
        owner_listener_id:99,source_application_id:88,
      }]};
    },
    async connect(){throw new Error("Unexpected connection acquisition");},
  };
  const persistence=createSupabasePersistence({
    databaseUrl:"postgresql://fixture",supabaseUrl:"https://fixture.invalid",secretKey:"fixture",
    buckets:{avatars:"avatars"},storageUrlFor:(bucket,value)=>`/${bucket}/${value}`,poolFactory:()=>fakePool,
  });
  const detail=await persistence.getAdminArtist(7);
  assert.deepEqual(Object.keys(detail).sort(),[
    "bio","category","created_at","follower_count","id","is_featured","location","name",
    "photo","status","stream_count","updated_at",
  ]);
  assert.equal(detail.photo,"/avatars/artist.jpg");
  assert.doesNotMatch(calls[0].sql,/artist\.\*/);
  assert.doesNotMatch(calls[0].sql,/owner_listener_id|source_application_id/);
  assert.deepEqual(calls[0].values,[7]);
});

test("Supabase route branch bypasses loadDb and existing Artist mutations remain registered", () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const routeStart = source.indexOf('app.get("/admin-api/artists"');
  const detailStart = source.indexOf('app.get("/admin-api/artists/:id"', routeStart);
  const route = source.slice(routeStart, detailStart);
  const supabaseBranch = route.slice(route.indexOf("if (USE_SUPABASE_PERSISTENCE)"), route.indexOf("const db = await loadDbWithPublishedReleases()", route.indexOf("if (USE_SUPABASE_PERSISTENCE)")));
  assert.match(supabaseBranch, /listAdminArtists/);
  assert.doesNotMatch(supabaseBranch, /loadDb/);
  for (const registration of [
    'app.post(\n  "/admin-api/artists"', '"/admin-api/artists/:id"',
    'app.delete("/admin-api/artists/:id"', 'app.post("/admin-api/artists/:id/suspend"',
    'app.post("/admin-api/artists/:id/restore"', 'app.post("/admin-api/artists/:id/feature"',
    'app.post("/admin-api/artists/:id/unfeature"',
  ]) assert.ok(source.includes(registration), registration);
});
