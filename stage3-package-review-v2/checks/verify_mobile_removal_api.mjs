import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Standalone Node validation of mobile API request wiring.
// Native imports are replaced with local stubs; no actual network or accounts are used.
const sourcePath = new URL('../mobile/src/api/musicApi.js', import.meta.url);
let source = await readFile(sourcePath, 'utf8');
source = source
  .replace(/^import AsyncStorage from "@react-native-async-storage\/async-storage";\s*$/m, '')
  .replace(/^import \{ API_BASE_URL \} from "\.\.\/config\/api";\s*$/m, '');
const stubs = `const AsyncStorage = { getItem: async () => null, setItem: async () => {} };\nconst API_BASE_URL = 'https://example.invalid';\n`;
const api = await import(`data:text/javascript;base64,${Buffer.from(stubs + source).toString('base64')}`);

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, ...options });
  return { ok: true, status: 200, json: async () => ({ id: 3, status: 'scheduled', due_at: '2026-11-13T00:00:00.000Z' }) };
};
try {
  api.setAuthToken('test-auth-token');
  const calls = [
    { fn: () => api.getArtistStudioSongs(), path: '/artist-studio/songs/', method: 'GET' },
    { fn: () => api.getArtistSongRemovalRequests(), path: '/artist-studio/song-removal-requests/', method: 'GET' },
    { fn: () => api.requestArtistSongRemoval(17, 'Artist asked to stop distribution'), path: '/artist-studio/songs/17/removal-requests/', method: 'POST', reason: 'Artist asked to stop distribution' },
    { fn: () => api.cancelArtistSongRemoval(3), path: '/artist-studio/song-removal-requests/3/cancel/', method: 'POST' },
  ];
  for (const row of calls) {
    await test(`${row.method} ${row.path}: authorized correctly`, async () => {
      const before = requests.length;
      await row.fn();
      assert.equal(requests.length, before + 1);
      const call = requests.at(-1);
      assert.equal(call.url, `https://example.invalid${row.path}`);
      assert.equal(call.method ?? 'GET', row.method);
      assert.equal(call.headers?.Authorization, 'Bearer test-auth-token');
      if (row.reason) {
        assert.equal(call.headers?.['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(call.body), { reason: row.reason });
      }
    });
  }
} finally {
  globalThis.fetch = originalFetch;
}
