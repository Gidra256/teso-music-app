const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../src/utils/discovery.js'), 'utf8').replace(/export /g, ''), ctx);
const song = (id, extra = {}) => ({ id, status: 'published', title: `Song ${id}`, release_date: '2026-01-01', play_count: id, ...extra });
const ids = list => Array.from(list, item => item.id);
test('new releases never substitute creation dates or include future/private music', () => {
  assert.deepEqual(ids(ctx.newReleases([song(1), song(2, { release_date: '2026-02-01' }), song(3, { release_date: null, created_at: '2026-09-01' }), song(4, { release_date: '2099-01-01' }), song(5, { status: 'draft' })])), [2, 1]);
});
test('sections reduce repetition without inventing popularity or featured status', () => {
  const result = ctx.buildHomeSections({ newSongs: [song(1)], popular: [song(1), song(2)], featured: [song(3), song(4, { is_featured: true })], more: [song(1), song(2), song(4), song(5)] });
  assert.deepEqual(ids(result.popular), [2]);
  assert.deepEqual(ids(result.featured), [4]);
  assert.deepEqual(ids(result.more), [5]);
  assert.deepEqual(ids(ctx.popularSongs([song(1, { play_count: 0 }), song(2, { play_count: null })])), []);
});
test('history is ordered, public-catalog reconciled, and never fabricated', () => {
  const result = ctx.buildHomeSections({ recent: [song(1), song(2), song(3, { status: 'hidden' })] }, [2, 3, 99, 1]);
  assert.deepEqual(ids(result.recent), [2, 1]);
  assert.deepEqual(ids(ctx.buildHomeSections({}).recent), []);
  assert.deepEqual(ids(ctx.uniqueItems([song(1), song(1), song(2)])), [1, 2]);
});
test('small catalogs retain genuine popular music without duplicating the filler row', () => {
  const result = ctx.buildHomeSections({ newSongs: [song(1)], popular: [song(1)], more: [song(1)] });
  assert.deepEqual(ids(result.popular), [1]);
  assert.deepEqual(ids(result.more), []);
});

function apiContext(fetchJson, setTimeout = global.setTimeout, clearTimeout = global.clearTimeout) {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/api/musicApi.js'), 'utf8');
  const start = source.indexOf('const discoveryRequests =');
  const end = source.indexOf('export async function getPlatformStatus', start);
  const ctx = vm.createContext({ fetchJson, authToken: '', URLSearchParams, AbortController, setTimeout, clearTimeout });
  vm.runInContext(source.slice(start, end).replace(/export /g, ''), ctx);
  return ctx;
}

test('identical in-flight discovery requests share one fetch, without caching failed results', async () => {
  let calls = 0, finish;
  const ctx = apiContext(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const first = ctx.getDiscoveryItems('songs', { discovery: 'new' });
  assert.equal(first, ctx.getDiscoveryItems('songs', { discovery: 'new' }));
  assert.equal(calls, 1);
  finish([song(1)]); await first;
  const next = ctx.getDiscoveryItems('songs', { discovery: 'new' });
  assert.equal(calls, 2); finish([song(2)]); assert.equal((await next)[0].id, 2);
});

test('discovery aborts a stuck request after twelve seconds and permits a retry', async () => {
  let timeout, duration, calls = 0;
  const ctx = apiContext((_, { signal }) => {
    calls++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  }, (fn, ms) => { timeout = fn; duration = ms; return 1; }, () => {});
  const first = ctx.getDiscoveryItems('songs');
  assert.equal(duration, 12000); timeout(); await assert.rejects(first, /aborted/);
  const second = ctx.getDiscoveryItems('songs');
  assert.equal(calls, 2); timeout(); await assert.rejects(second, /aborted/);
});
