export function songKey(song) {
  return song?.id == null ? "" : String(song.id);
}

// Queue edits are observable; the audio clock never writes to this store.
export function createPlaybackQueue({ random = Math.random, now = Date.now } = {}) {
  let sequence = 0;
  let state = { entries: [], currentIndex: -1, currentEntry: null, upcoming: [], repeatMode: "off", shuffled: false };
  let canonical = [];
  let lastCommand = null;
  const listeners = new Set();
  const entry = song => ({ id: `queue-${++sequence}`, song });
  function update(patch) {
    state = { ...state, ...patch };
    state.currentEntry = state.entries[state.currentIndex] || null;
    state.upcoming = state.entries.slice(state.currentIndex + 1);
    listeners.forEach(listener => listener());
    return state.currentEntry;
  }
  function allowed(key) {
    const time = now();
    if (lastCommand?.key === key && time - lastCommand.time < 350) return false;
    lastCommand = { key, time };
    return true;
  }
  function shuffled(entries) {
    const result = [...entries];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function start(song, songs = []) {
    const source = Array.isArray(songs) && songs.length ? songs.filter(item => songKey(item)) : [song];
    let index = source.findIndex(item => songKey(item) === songKey(song));
    if (index < 0) { source.unshift(song); index = 0; }
    const entries = source.map(entry);
    entries[index] = { ...entries[index], song };
    canonical = entries.map(item => item.id);
    lastCommand = null;
    return update({ entries: state.shuffled ? [...entries.slice(0, index + 1), ...shuffled(entries.slice(index + 1))] : entries, currentIndex: index });
  }
  function select(id, guarded = true) {
    const index = state.entries.findIndex(item => item.id === id);
    if (index < 0 || (guarded && !allowed(`select:${id}`))) return null;
    return update({ currentIndex: index });
  }
  function advance(direction, automatic = false) {
    if (!automatic && !allowed(direction > 0 ? "next" : "previous")) return null;
    let index = state.currentIndex + direction;
    if (index >= state.entries.length) index = state.repeatMode === "all" ? 0 : -1;
    if (index < 0 || !state.entries[index]) return null;
    return select(state.entries[index].id, false);
  }
  function enqueue(song, next = false) {
    if (!songKey(song) || !allowed(`${next ? "insert" : "append"}:${songKey(song)}`)) return false;
    const added = entry(song);
    const entries = [...state.entries];
    const index = next ? state.currentIndex + 1 : entries.length;
    entries.splice(index, 0, added);
    // Play Next stays ahead of the remaining songs even when shuffle is disabled.
    const firstUpcoming = state.upcoming.length
      ? Math.min(...state.upcoming.map(item => canonical.indexOf(item.id))) : canonical.length;
    canonical.splice(next ? firstUpcoming : canonical.length, 0, added.id);
    update({ entries });
    return true;
  }
  function remove(id) {
    const index = state.entries.findIndex(item => item.id === id);
    if (index <= state.currentIndex || index < 0) return false;
    canonical = canonical.filter(value => value !== id);
    update({ entries: state.entries.filter(item => item.id !== id) });
    return true;
  }
  function move(id, offset) {
    const index = state.entries.findIndex(item => item.id === id);
    const target = index + offset;
    if (index <= state.currentIndex || target <= state.currentIndex || target >= state.entries.length || index < 0) return false;
    if (!allowed(`move:${id}:${offset}`)) return false;
    const entries = [...state.entries];
    entries.splice(target, 0, entries.splice(index, 1)[0]);
    canonical = entries.map(item => item.id);
    update({ entries });
    return true;
  }
  function toggleShuffle() {
    const upcoming = state.shuffled
      ? [...state.upcoming].sort((a, b) => canonical.indexOf(a.id) - canonical.indexOf(b.id))
      : shuffled(state.upcoming);
    update({ entries: [...state.entries.slice(0, state.currentIndex + 1), ...upcoming], shuffled: !state.shuffled });
    return state.shuffled;
  }
  function toggleRepeat() {
    const modes = ["off", "all", "one"];
    update({ repeatMode: modes[(modes.indexOf(state.repeatMode) + 1) % modes.length] });
    return state.repeatMode;
  }
  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    start, select, advance, enqueue, remove, move, toggleRepeat, toggleShuffle,
  };
}
