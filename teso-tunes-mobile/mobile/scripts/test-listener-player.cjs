// Real React rendering with an isolated Expo audio adapter. Does not replace device testing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const babel = require('@babel/core');
const testModules = process.env.LISTENER_TEST_MODULES || path.join(require('node:os').tmpdir(), 'tesohub-listener-test-tools/node_modules');
const React = require(path.join(testModules, 'react'));
const renderer = require(path.join(testModules, 'react-test-renderer'));
global.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = renderer;
const sourceRoot = path.resolve('src');
const song = id => ({ id, title: `Song ${id}`, audio_file: `https://audio.test/${id}` });
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(baseline = false) {
  const players = [], storage = new Map(), plays = [];
  const apiMock = { incrementSongPlay: async id => { plays.push(id); } };
  let deferSession = null;
  const audio = {
    setAudioModeAsync: async () => { if (deferSession) await deferSession; },
    createAudioPlayer: () => {
      let handler;
      const player = {
        currentStatus: { isLoaded: true, playing: false, currentTime: 0, duration: 100, didJustFinish: false },
        seekRequests: [], removed: false, playCalls: 0,
        play() { this.playCalls++; this.emit({ playing: true, didJustFinish: false }); },
        pause() { this.emit({ playing: false }); },
        async seekTo(time) { this.seekRequests.push(time); if (this.seekGate) await this.seekGate; this.emit({ currentTime: time, didJustFinish: false }); },
        remove() { this.removed = true; },
        addListener(_event, callback) { handler = callback; return { remove() { handler = null; } }; },
        emit(patch) { Object.assign(this.currentStatus, patch); handler?.({ ...this.currentStatus }); },
      };
      players.push(player); return player;
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    let source = fs.readFileSync(file, 'utf8');
    if (baseline && file.endsWith('PlayerContext.js')) source = execFileSync('git', ['show', '167e1fb:teso-tunes-mobile/mobile/src/context/PlayerContext.js'], { encoding: 'utf8' });
    const result = babel.transformSync(source, { filename: file, configFile: false, babelrc: false, plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require.resolve('@babel/plugin-transform-modules-commonjs')] });
    const module = { exports: {} }; modules.set(file, module);
    const mockRequire = id => {
      if (id === 'react') return React;
      if (id === 'react/jsx-runtime') return require(path.join(testModules, 'react/jsx-runtime'));
      if (id === 'expo-audio') return audio;
      if (id === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' }, View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: styles => styles }, PanResponder: { create: handlers => ({ panHandlers: handlers }) } };
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (id === '@react-native-async-storage/async-storage') return { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); } };
      if (id.endsWith('/musicApi')) return apiMock;
      return load(path.resolve(path.dirname(file), `${id}.js`));
    };
    vm.runInThisContext(`(function(require,module,exports){${result.code}\n})`, { filename: file })(mockRequire, module, module.exports);
    return module.exports;
  }
  const api = load(path.join(sourceRoot, 'context/PlayerContext.js'));
  const queueApi = !baseline ? load(path.join(sourceRoot, 'context/PlaybackQueueContext.js')) : null;
  let state, progress, queue, mainRenders = 0, progressRenders = 0, queueRenders = 0, tree;
  function Main() { state = api.usePlayer(); mainRenders++; return null; }
  function Progress() { progress = api.usePlayerProgress ? api.usePlayerProgress() : api.usePlayer(); progressRenders++; return null; }
  function Queue() { queue = queueApi.usePlaybackQueue(); queueRenders++; return null; }
  return {
    load, apiMock, players, storage, plays, get state() { return state; }, get progress() { return progress; },
    get queue() { return queue; },
    get renders() { return { main: mainRenders, progress: progressRenders, queue: queueRenders }; },
    async mount() { await act(async () => { tree = renderer.create(React.createElement(api.PlayerProvider, null, React.createElement(Main), React.createElement(Progress), queueApi ? React.createElement(Queue) : null)); await flush(); }); },
    async unmount() { await act(async () => tree.unmount()); },
    deferSession(promise) { deferSession = promise; },
  };
}

async function performance(baseline) {
  const h = harness(baseline); await h.mount();
  try {
    await act(async () => { await h.state.playSong(song(1)); await flush(); });
    const p = h.players.at(-1);
    await act(async () => p.emit({ currentTime: 0.1 }));
    const start = h.renders;
    for (let i = 1; i <= 20; i++) await act(async () => p.emit({ currentTime: i }));
    return { main: h.renders.main - start.main, progress: h.renders.progress - start.progress, queue: h.renders.queue - start.queue };
  } finally { await h.unmount(); }
}

(async () => {
  const before = await performance(true), after = await performance(false);
  assert.equal(after.main, 0); assert.equal(after.progress, 20); assert.ok(before.main >= 20);
  assert.equal(after.queue, 0, 'Queue consumers do not render for progress ticks');
  console.log('PASS 20 measured audio updates, React consumer renders:', { before, after });
  const h = harness(); await h.mount();
  try {
    await act(async () => h.state.playSong(song(1), [song(1), song(2), song(3)]));
    let p = h.players.at(-1);
    assert.equal(h.state.recentlyPlayed.length, 0, 'Starting a request alone is not listening history');
    await act(async () => p.emit({ currentTime: 1 }));
    assert.equal(h.state.recentlyPlayed[0].id, 1); assert.deepEqual(h.plays, [1]);
    const actions = h.state.playSong;
    await act(async () => { h.state.togglePlay(); h.state.togglePlay(); h.state.togglePlay(); });
    assert.equal(h.state.isPlaying, false); assert.equal(p.currentStatus.playing, false);
    assert.equal(h.state.playSong, actions, 'Action identity stays stable');
    let releaseSeek;
    p.seekGate = new Promise(resolve => { releaseSeek = resolve; });
    let seek;
    await act(async () => { seek = h.state.seekTo(60); await flush(); });
    assert.equal(h.progress.currentTime, 60);
    await act(async () => p.emit({ currentTime: 1 }));
    assert.equal(h.progress.currentTime, 60, 'Late pre-seek position must not reset thumb');
    await act(async () => { h.state.seekTo(70); h.state.seekTo(80); releaseSeek(); await seek; });
    assert.equal(h.progress.currentTime, 80); assert.deepEqual(p.seekRequests, [60, 80], 'Coalesced seek sends only latest pending target');
    assert.equal(h.state.isPlaying, false);
    await act(async () => h.state.seekTo(-20)); assert.equal(h.progress.currentTime, 0);
    await act(async () => h.state.seekTo(999)); assert.equal(h.progress.currentTime, 100);
    await act(async () => { p.emit({ didJustFinish: true, playing: false, currentTime: 100 }); await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(h.state.currentSong.id, 2); assert.ok(p.removed); p = h.players.at(-1);
    await act(async () => p.emit({ currentTime: 2 }));
    assert.equal(h.state.recentlyPlayed[0].id, 2);
    await act(async () => h.state.toggleShuffle());
    await act(async () => { h.state.playNextSong(); await flush(); });
    assert.notEqual(h.state.currentSong.id, 2);
    await act(async () => h.state.toggleShuffle());
    p = h.players.at(-1);
    await act(async () => { h.state.toggleRepeat(); h.state.toggleRepeat(); });
    assert.equal(h.state.repeatMode, 'one');
    await act(async () => { p.emit({ currentTime: 100, didJustFinish: true, playing: false }); await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(p.currentStatus.currentTime, 0); assert.equal(p.currentStatus.playing, true);
    await act(async () => {
      p.emit({ currentTime: 100, didJustFinish: true, playing: false });
      h.state.togglePlay(); h.state.togglePlay();
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.equal(p.currentStatus.playing, false, 'A queued repeat cannot undo a newer pause');
    await act(async () => p.emit({ playbackState: 'error' }));
    assert.ok(h.state.playbackError); assert.equal(h.state.isPlaying, false);
    await act(async () => h.state.retryPlayback()); assert.equal(h.state.playbackError, '');
    assert.equal(h.players.filter(player => !player.removed).length, 1);
    console.log('PASS native adapter: rapid pause/play, history, stale status, coalesced seek, bounds, replay, queue, shuffle, repeat, failure/retry, single player');
  } finally { await h.unmount(); }
  const queueHarness = harness(); await queueHarness.mount();
  try {
    const h = queueHarness;
    await act(async () => h.state.playSong(song('1'), [song(1), song(2), song(3)]));
    const original = h.players.at(-1), firstEntry = h.queue.currentEntry.id;
    await act(async () => { h.state.playNext(song(1)); h.state.playNext(song(1)); h.state.addToQueue(song(4)); });
    assert.deepEqual(h.queue.upcoming.map(e => e.song.id), [1, 2, 3, 4]);
    assert.equal(h.players.at(-1), original, 'Editing queue does not restart current audio');
    const duplicate = h.queue.upcoming[0];
    await act(async () => { h.state.playQueueEntry(duplicate.id); await flush(); });
    assert.notEqual(h.queue.currentEntry.id, firstEntry);
    assert.equal(h.queue.currentEntry.id, duplicate.id);
    assert.ok(original.removed, 'Duplicate entry starts a new instance of the same song');
    await act(async () => { h.state.playNextSong(); h.state.playNextSong(); await flush(); });
    assert.equal(h.state.currentSong.id, 2, 'Rapid Next advances only once');
    const target = h.queue.upcoming.at(-1);
    await act(async () => h.queue.removeEntry(h.queue.upcoming[0].id));
    await act(async () => h.state.playQueueEntry(target.id));
    let player = h.players.at(-1);
    await act(async () => { player.emit({ currentTime: 100, playing: false, didJustFinish: true }); await new Promise(r => setTimeout(r, 10)); });
    assert.equal(h.state.currentSong.id, 4); assert.equal(h.state.isPlaying, false);
    await act(async () => h.state.togglePlay()); assert.equal(player.currentStatus.currentTime, 0);
    await act(async () => h.state.toggleRepeat()); assert.equal(h.state.repeatMode, 'all');
    await act(async () => { player.emit({ currentTime: 100, playing: false, didJustFinish: true }); await new Promise(r => setTimeout(r, 10)); });
    assert.equal(h.queue.currentEntry.id, firstEntry);
    await act(async () => h.state.playSong(song(9), [song(9)]));
    await act(async () => { h.state.toggleRepeat(); h.state.toggleRepeat(); });
    player = h.players.at(-1);
    await act(async () => { player.emit({ currentTime: 100, playing: false, didJustFinish: true }); await new Promise(r => setTimeout(r, 10)); });
    assert.equal(h.players.at(-1), player); assert.equal(h.state.isPlaying, false);
    console.log('PASS native queue: normalized IDs, duplicate entries, double-tap guard, no edit restart, select/remove, stop/replay at end, Repeat All and single-item queue');
  } finally { await queueHarness.unmount(); }
  const slow = harness();
  let ready;
  slow.deferSession(new Promise(resolve => { ready = resolve; }));
  await slow.mount();
  try {
    let first, second;
    await act(async () => {
      first = slow.state.playSong(song(1));
      second = slow.state.playSong(song(2));
      slow.state.playSong(song(2));
      slow.state.togglePlay();
    });
    assert.equal(slow.state.currentSong.id, 2);
    assert.equal(slow.state.isPlaying, false);
    await act(async () => { ready(); await first; await second; });
    assert.equal(slow.players.length, 1, 'Superseded loads and duplicate song taps cannot create extra audio players');
    assert.equal(slow.players[0].playCalls, 0, 'Pause during session preparation must stick');
    assert.equal(slow.state.recentlyPlayed.length, 0);
    await act(async () => { await slow.state.seekTo(45); await slow.state.togglePlay(); });
    assert.equal(slow.state.recentlyPlayed.length, 0, 'Seeking alone is not listening history');
    await act(async () => slow.players[0].emit({ currentTime: 46 }));
    assert.equal(slow.state.recentlyPlayed[0].id, 2, 'Advancing audio creates genuine history');
    console.log('PASS native slow session: latest song wins, duplicate load blocked, pause honored, no fake history');
  } finally { await slow.unmount(); }
  const { default: SeekBar } = harness().load(path.join(sourceRoot, 'components/SeekBar.js'));
  let bar;
  const seeks = [], previews = [];
  const props = { currentTime: 20, duration: 100, onSeek: time => seeks.push(time), onSeekingChange: (seeking, time) => previews.push({ seeking, time }) };
  const slider = () => bar.root.findByProps({ accessibilityLabel: 'Song progress' });
  await act(async () => { bar = renderer.create(React.createElement(SeekBar, props)); });
  try {
    await act(async () => slider().props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
    await act(async () => slider().props.onPanResponderGrant({ nativeEvent: { locationX: 30 } }));
    await act(async () => slider().props.onPanResponderMove({}, { dx: 70 }));
    assert.equal(previews.at(-1).time, 50); assert.equal(seeks.length, 0);
    await act(async () => bar.update(React.createElement(SeekBar, { ...props, currentTime: 21, onSeekingChange: (...args) => props.onSeekingChange(...args) })));
    await act(async () => slider().props.onPanResponderRelease());
    assert.deepEqual(seeks, [50], 'Status rerenders cannot reset a native drag');
    await act(async () => slider().props.onPanResponderGrant({ nativeEvent: { locationX: 180 } }));
    await act(async () => slider().props.onPanResponderTerminate());
    assert.deepEqual(seeks, [50], 'Cancelled gesture never seeks');
    await act(async () => slider().props.onPanResponderGrant({ nativeEvent: { locationX: 100 } }));
    const oldRelease = slider().props.onPanResponderRelease;
    await act(async () => bar.update(React.createElement(SeekBar, { ...props, key: 'new-song', duration: 0 })));
    await act(async () => oldRelease());
    assert.deepEqual(seeks, [50], 'Old-song drag cannot seek the next song');
    assert.equal(slider().props.onStartShouldSetPanResponder(), false);
    console.log('PASS native seek gestures: measured width, live preview, one release, changing callbacks/status, cancellation, song change, unknown duration');
  } finally { await act(async () => bar.unmount()); }
  const engagement = harness();
  const engagementModule = engagement.load(path.join(sourceRoot, 'context/EngagementContext.js'));
  let value, engagementTree, likeCalls = 0, followCalls = 0;
  engagement.apiMock.likeSong = async () => { likeCalls++; return { liked: true, like_count: 2 }; };
  engagement.apiMock.followArtist = async () => { followCalls++; return { followed: true, follower_count: 2 }; };
  engagement.apiMock.unlikeSong = async () => { throw Error('Isolated offline failure'); };
  function EngagementReader() { value = engagementModule.useEngagement(); return null; }
  await act(async () => { engagementTree = renderer.create(React.createElement(engagementModule.EngagementProvider, null, React.createElement(EngagementReader))); await flush(); });
  try {
    const track = { id: 1, like_count: 5 }, artist = { id: 11, follower_count: 10 };
    await act(async () => { await Promise.all([value.toggleSongLike(track), value.toggleSongLike(track)]); });
    assert.equal(likeCalls, 1); assert.equal(value.getSongLikeCount(track), 2, 'Authoritative count may be lower than optimistic count');
    await act(async () => { await Promise.all([value.followArtistAction(artist), value.followArtistAction(artist)]); });
    assert.equal(followCalls, 1); assert.equal(value.getArtistFollowerCount(artist), 2);
    await act(async () => value.followArtistAction({ id: 12, follower_count: 20 }));
    assert.equal(value.getArtistFollowerCount(artist), 2);
    assert.equal(value.isArtistFollowed(11), true); assert.equal(value.isArtistFollowed(12), true);
    await act(async () => value.toggleSongLike(track));
    assert.equal(value.isSongLiked(1), true); assert.equal(value.getSongLikeCount(track), 2);
    assert.equal(value.isSongLikePending(1), false);
    console.log('PASS engagement: duplicate locks, authoritative lower counts, artist isolation, failed unlike rollback/unlock');
  } finally { await act(async () => engagementTree.unmount()); }
})().catch(error => { console.error(error); process.exitCode = 1; });
