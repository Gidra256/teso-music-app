const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const babel = require('@babel/core');
const vm = require('node:vm');
const moduleObject = { exports: {} };
const compiled = babel.transformSync(fs.readFileSync('src/utils/playbackQueue.js', 'utf8'), {
  configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;
vm.runInThisContext(`(function(exports){${compiled}\n})`)(moduleObject.exports);
const { createPlaybackQueue } = moduleObject.exports;
const song = id => ({ id, title: `Song ${id}` });
function fixture() {
  let clock = 1000;
  const q = createPlaybackQueue({ now: () => clock, random: () => 0 });
  return { q, wait: () => { clock += 400; }, ids: () => q.getSnapshot().upcoming.map(e => e.song.id) };
}

test('source contexts preserve order, normalized IDs and selected position', () => {
  for (const source of ['Home', 'Recent', 'Search', 'Browse', 'Artist', 'Playlist', 'Library']) {
    const { q, ids } = fixture();
    q.start(song('2'), [song(1), song(2), song(3)]);
    assert.equal(q.getSnapshot().currentIndex, 1, source);
    assert.deepEqual(ids(), [3]);
    assert.equal(q.getSnapshot().currentEntry.song.id, '2');
  }
  const { q } = fixture(); q.start(song(7));
  assert.equal(q.getSnapshot().entries.length, 1, 'Shared link is standalone');
});
test('natural Next stops at tail and Previous never wraps before head', () => {
  const { q } = fixture(); q.start(song(1), [song(1), song(2)]);
  assert.equal(q.advance(-1), null);
  assert.equal(q.advance(1, true).song.id, 2);
  assert.equal(q.advance(1, true), null);
  assert.equal(q.getSnapshot().currentEntry.song.id, 2);
});
test('Repeat cycles off/all/one/off; Repeat All alone wraps Next', () => {
  const { q } = fixture(); q.start(song(1));
  const id = q.getSnapshot().currentEntry.id;
  assert.equal(q.toggleRepeat(), 'all');
  assert.equal(q.advance(1, true).id, id);
  assert.equal(q.toggleRepeat(), 'one');
  assert.equal(q.advance(1, true), null, 'Manual Next does not mean repeat one');
  assert.equal(q.toggleRepeat(), 'off');
});
test('Play Next/append support intentional duplicates with distinct IDs and guard double taps', () => {
  const { q, ids, wait } = fixture(); q.start(song(1), [song(1), song(2)]);
  const current = q.getSnapshot().currentEntry;
  assert.equal(q.enqueue(song(3), true), true);
  assert.equal(q.enqueue(song(3), true), false);
  assert.deepEqual(ids(), [3, 2]);
  assert.equal(q.enqueue(song(1)), true);
  assert.equal(q.enqueue(song(1)), false);
  wait(); assert.equal(q.enqueue(song('1')), true);
  assert.deepEqual(ids(), [3, 2, 1, '1']);
  assert.equal(q.getSnapshot().currentEntry, current);
  assert.equal(new Set(q.getSnapshot().entries.map(e => e.id)).size, 5);
});
test('remove and reorder address an entry, never all duplicates or current/history', () => {
  const { q, ids } = fixture(); q.start(song(1), [song(1), song(2), song(2), song(3)]);
  const [first, second, third, fourth] = q.getSnapshot().entries;
  assert.equal(q.remove(first.id), false);
  assert.equal(q.move(second.id, -1), false);
  assert.equal(q.move(fourth.id, -2), true); assert.deepEqual(ids(), [3, 2, 2]);
  assert.equal(q.remove(second.id), true); assert.deepEqual(ids(), [3, 2]);
  q.select(third.id); assert.equal(q.getSnapshot().currentEntry.id, third.id);
  assert.equal(q.remove(fourth.id), false);
});
test('shuffle permutes upcoming once, preserves current, follows displayed order, restores remainder', () => {
  const { q, ids, wait } = fixture(); q.start(song(1), [1, 2, 3, 4, 5].map(song));
  const current = q.getSnapshot().currentEntry;
  q.toggleShuffle(); assert.equal(q.getSnapshot().currentEntry, current);
  const expected = [...ids()]; assert.deepEqual([...expected].sort(), [2, 3, 4, 5]);
  assert.notDeepEqual(expected, [2, 3, 4, 5]);
  const played = q.advance(1, true); assert.equal(played.song.id, expected[0]);
  wait(); assert.equal(q.advance(-1).id, current.id);
  q.advance(1, true); q.toggleShuffle();
  assert.deepEqual(ids(), [2, 3, 4, 5].filter(id => id !== played.song.id));
  const rest = []; while (q.getSnapshot().upcoming.length) rest.push(q.advance(1, true).song.id);
  assert.equal(new Set([played.song.id, ...rest]).size, 4);
});
test('rapid Next is guarded and selected duplicate entries retain their identity', () => {
  const { q, wait } = fixture(); q.start(song(1), [1, 1, 1].map(song));
  const next = q.advance(1); assert.equal(q.advance(1), null);
  wait(); assert.notEqual(q.advance(1).id, next.id);
  assert.equal(q.getSnapshot().currentIndex, 2);
});
test('Play Next retains priority when turning shuffle off after advancing', () => {
  const { q, ids } = fixture(); q.start(song(1), [1, 2, 3, 4].map(song));
  q.toggleShuffle(); q.advance(1, true); q.advance(1, true);
  assert.equal(q.getSnapshot().currentEntry.song.id, 4);
  q.enqueue(song(5), true); q.toggleShuffle(); assert.deepEqual(ids(), [5, 2]);
});
test('empty queue accepts local additions without starting audio or requiring an account', () => {
  const { q, ids } = fixture(); q.enqueue(song(1));
  assert.equal(q.getSnapshot().currentEntry, null); assert.deepEqual(ids(), [1]);
  q.select(q.getSnapshot().upcoming[0].id); assert.equal(q.getSnapshot().currentEntry.song.id, 1);
});
test('snapshots are stable until a queue command and unsubscribe releases listeners', () => {
  const { q } = fixture(); const snapshot = q.getSnapshot(); let events = 0;
  const stop = q.subscribe(() => events++);
  assert.equal(q.getSnapshot(), snapshot); q.start(song(1)); assert.equal(events, 1);
  const next = q.getSnapshot(); q.remove(next.currentEntry.id); assert.equal(q.getSnapshot(), next);
  stop(); q.enqueue(song(2)); assert.equal(events, 1);
});
