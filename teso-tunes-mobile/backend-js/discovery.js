// Optional catalog projections. Unfiltered callers retain their existing API contract.
export function discoveryOptions(query = {}) {
  const enabled = query.limit !== undefined || query.ids !== undefined || query.discovery !== undefined;
  if (!enabled) return {};
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 8));
  const discovery = ["new", "popular", "featured", "more"].includes(query.discovery) ? query.discovery : "more";
  const ids = query.ids === undefined ? null : [...new Set(String(query.ids).split(",")
    .filter(value => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))).map(Number))].slice(0, 50);
  return { limit, discovery, ids };
}

export function selectDiscovery(items, options, kind = "song", today = new Date().toISOString().slice(0, 10)) {
  if (!options.limit) return items;
  let result = items.filter(item => kind !== "song" || item.status === "published");
  if (options.ids) result = result.filter(item => options.ids.includes(Number(item.id)));
  if (options.discovery === "featured") result = result.filter(item => item.is_featured);
  if (kind === "song") {
    if (options.discovery === "new") {
      result = result.filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.release_date || "") && item.release_date <= today);
      result.sort((a, b) => b.release_date.localeCompare(a.release_date) || Number(b.id) - Number(a.id));
    }
    if (options.discovery === "popular") {
      result = result.filter(item => Number(item.play_count) > 0);
      result.sort((a, b) => Number(b.play_count) - Number(a.play_count) || Number(b.id) - Number(a.id));
    }
    if (options.discovery === "more") result.sort((a, b) => Number(b.id) - Number(a.id));
  }
  return result.slice(0, options.limit);
}

export function discoverySql(options, params, kind = "song") {
  if (!options.limit) return { filters: [], order: "", limit: "" };
  const filters = kind === "song" ? ["song.status = 'published'"] : [];
  if (options.ids) {
    params.push(options.ids);
    filters.push(`${kind}.id = any($${params.length}::bigint[])`);
  }
  if (options.discovery === "featured") filters.push(`${kind}.is_featured = true`);
  let order = "";
  if (kind === "song" && options.discovery === "new") {
    filters.push("song.release_date is not null", "song.release_date <= (now() at time zone 'UTC')::date");
    order = "song.release_date desc, song.id desc";
  }
  if (kind === "song" && options.discovery === "popular") {
    filters.push("song.play_count > 0");
    order = "song.play_count desc, song.id desc";
  }
  if (kind === "song" && options.discovery === "more") order = "song.id desc";
  params.push(options.limit);
  return { filters, order, limit: `limit $${params.length}` };
}
