import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverSource = fs.readFileSync(path.join(root, "backend-js", "server.js"), "utf8");
const renderConfig = fs.readFileSync(path.join(root, "..", "render.yaml"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "mobile", "public", "service-worker.js"), "utf8");

test("production PWA uses the custom API and public web domains", () => {
  assert.match(renderConfig, /EXPO_PUBLIC_MUSIC_API_BASE_URL\s*\r?\n\s*value: https:\/\/api\.tesohubmusic\.com\/api/);
  assert.match(renderConfig, /EXPO_PUBLIC_SHARE_BASE_URL\s*\r?\n\s*value: https:\/\/tesohubmusic\.com/);
  assert.match(renderConfig, /EXPO_PUBLIC_MUSIC_WEB_URL\s*\r?\n\s*value: https:\/\/tesohubmusic\.com/);
});

test("backend CORS explicitly retains every required production PWA origin", () => {
  for (const origin of [
    "https://tesohubmusic.com",
    "https://www.tesohubmusic.com",
    "https://tesohub-music-pwa.onrender.com",
  ]) {
    assert.ok(serverSource.includes(`\"${origin}\"`), `${origin} must remain allowlisted`);
  }
  assert.doesNotMatch(serverSource, /app\.use\(cors\(\)\)/);
  assert.match(serverSource, /credentials:\s*true/);
});

test("custom API host is preferred for generated media without rewriting external storage URLs", () => {
  assert.match(serverSource, /PUBLIC_API_BASE_URL/);
  assert.match(serverSource, /requestBase === PUBLIC_API_BASE_URL/);
  assert.ok(serverSource.includes('if (/^https?:\\/\\//i.test(value)) return value;'));
});

test("service worker bypasses cross-origin API and media requests", () => {
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /request\.destination === \"audio\"/);
  assert.match(serviceWorker, /request\.mode === \"navigate\"/);
});
