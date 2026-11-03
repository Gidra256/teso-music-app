import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");
const admin = fs.readFileSync(new URL("public/index.html", root), "utf8");
const draft = fs.readFileSync(new URL("../legal/ARTIST_AGREEMENT_V1.0_DRAFT.md", root), "utf8");

test("Admin agreement registry is permission protected and enforcement remains explicit", () => {
  for (const route of [
    "/admin-api/artist-agreements",
    "/admin-api/artist-agreements/:id",
    "/admin-api/artist-agreements/:id/publish",
  ]) assert.ok(server.includes(route), route);
  assert.match(server, /requireAdminPermission\("settings"\)/);
  assert.match(server, /PUBLISH ARTIST AGREEMENT/);
  assert.match(server, /Publish an approved Artist Agreement before enabling enforcement/);
  assert.match(server, /artist_agreement_enforcement_confirmed/);
  assert.match(server, /status: "accepted"/);
});

test("Admin UI manages drafts, versions, acceptance and missing artists without auto-enabling", () => {
  for (const copy of [
    "Artist Agreements",
    "Prepare a new draft",
    "Agreement versions",
    "Artists missing current acceptance",
    "Recent acceptance records",
    "Published content becomes immutable",
    "Enforcement remains unchanged",
  ]) assert.ok(admin.includes(copy), copy);
  assert.match(admin, /artist_agreement_enforcement_mode/);
  assert.match(admin, /value="off"/);
  assert.doesNotMatch(admin, /artist_agreement_enforcement_mode[^\n]+value="all_artists"[^\n]+selected/);
});

test("Version 1.0 is a non-enforced draft covering the approved business principles", () => {
  assert.match(draft, /Version:\*\* 1\.0 DRAFT/);
  assert.match(draft, /Not published and not in force/);
  assert.match(draft, /has not been represented as legally reviewed/);
  for (const principle of [
    "keeps ownership",
    "limited, non-exclusive",
    "initially free",
    "No specific royalty percentage",
    "30-day notice period",
    "laws of Uganda",
    "Electronic acceptance",
  ]) assert.ok(draft.includes(principle), principle);
});
