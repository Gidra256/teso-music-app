export const HOME_LIMIT = 8;

export function uniqueItems(items = []) {
  const seen = new Set();
  return items.filter(item => item?.id && !seen.has(String(item.id)) && seen.add(String(item.id)));
}

export function newReleases(items, today = new Date().toISOString().slice(0, 10)) {
  return uniqueItems(items).filter(song => song.status === "published" &&
    /^\d{4}-\d{2}-\d{2}$/.test(song.release_date || "") && song.release_date <= today)
    .sort((a, b) => b.release_date.localeCompare(a.release_date) || Number(b.id) - Number(a.id));
}

export function popularSongs(items) {
  return uniqueItems(items).filter(song => song.status === "published" && Number(song.play_count) > 0)
    .sort((a, b) => Number(b.play_count) - Number(a.play_count) || Number(b.id) - Number(a.id));
}

export function buildHomeSections(data, historyIds = []) {
  const recentMap = new Map((data.recent || []).filter(song => song.status === "published").map(song => [String(song.id), song]));
  const recent = historyIds.map(id => recentMap.get(String(id))).filter(Boolean).slice(0, 6);
  const newest = newReleases(data.newSongs || []).slice(0, HOME_LIMIT);
  const shown = new Set(newest.map(song => String(song.id)));
  const ranked = popularSongs(data.popular || []);
  const freshPopular = ranked.filter(song => !shown.has(String(song.id)));
  // A genuinely popular track remains useful in a very small catalog.
  const popular = (freshPopular.length ? freshPopular : ranked.slice(0, 3)).slice(0, HOME_LIMIT);
  const featured = uniqueItems(data.featured || []).filter(song => song.status === "published" && song.is_featured).slice(0, HOME_LIMIT);
  [...popular, ...featured, ...recent].forEach(song => shown.add(String(song.id)));
  const more = uniqueItems(data.more || []).filter(song => song.status === "published" && !shown.has(String(song.id))).slice(0, HOME_LIMIT);
  return { recent, newest, popular, featured, more };
}
