const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const acorn = require("acorn");

const outputDir = path.resolve(process.argv[2] || "dist");

function findFiles(root, predicate) {
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(absolute, predicate));
    else if (predicate(absolute)) results.push(absolute);
  }
  return results;
}

test("export contains the static startup fallback", () => {
  const html = fs.readFileSync(path.join(outputDir, "index.html"), "utf8");
  assert.match(html, /class="startup-fallback"/);
  assert.match(html, /TesoHub Music/);
  assert.match(html, /Loading\.\.\./);
  assert.match(html, /browser may not support the full TesoHub Music app/);
});

test("final emitted JavaScript parses as ES2017", () => {
  const bundles = findFiles(outputDir, (file) => file.endsWith(".js"));
  assert.ok(bundles.length > 0, "Expected at least one emitted JavaScript file");
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, "utf8");
    acorn.parse(source, { ecmaVersion: 2017, sourceType: "script" });
  }
});

test("production API and web domains are preserved without the raw Render API base", () => {
  const bundles = findFiles(outputDir, (file) => file.endsWith(".js"));
  const source = bundles.map((bundle) => fs.readFileSync(bundle, "utf8")).join("\n");
  assert.match(source, /https:\/\/api\.tesohubmusic\.com\/api/);
  assert.match(source, /https:\/\/tesohubmusic\.com/);
  assert.doesNotMatch(source, /https:\/\/teso-music-app\.onrender\.com\/api/);
});

test("service worker and manifest are emitted", () => {
  assert.equal(fs.existsSync(path.join(outputDir, "service-worker.js")), true);
  assert.equal(fs.existsSync(path.join(outputDir, "manifest.webmanifest")), true);
});
