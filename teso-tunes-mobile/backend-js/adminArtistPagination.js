export const ADMIN_ARTIST_PAGE_SIZE = 25;
export const ADMIN_ARTIST_MAX_PAGE_SIZE = 100;
export const ADMIN_ARTIST_SEARCH_MAX_LENGTH = 100;
export const ADMIN_ARTIST_STATUSES = new Set(["active", "suspended", "removed"]);

const ADMIN_ARTIST_SORTS = new Set(["name", "created_at", "updated_at", "id"]);
const ADMIN_ARTIST_DIRECTIONS = new Set(["asc", "desc"]);

function positiveInteger(value, fallback, field) {
  if (value === undefined || value === null || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${field} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return parsed;
}

export function parseAdminArtistListQuery(query = {}) {
  const page = positiveInteger(query.page, 1, "page");
  const requestedPageSize = positiveInteger(query.page_size, ADMIN_ARTIST_PAGE_SIZE, "page_size");
  const search = String(query.search || "").trim();
  const status = String(query.status || "").trim();
  const sort = String(query.sort || "name").trim();
  const direction = String(query.direction || "asc").trim().toLowerCase();

  if (search.length > ADMIN_ARTIST_SEARCH_MAX_LENGTH) {
    throw new Error(`search must be ${ADMIN_ARTIST_SEARCH_MAX_LENGTH} characters or fewer.`);
  }
  if (status && !ADMIN_ARTIST_STATUSES.has(status)) throw new Error("Invalid artist status.");
  if (!ADMIN_ARTIST_SORTS.has(sort)) throw new Error("Invalid artist sort field.");
  if (!ADMIN_ARTIST_DIRECTIONS.has(direction)) throw new Error("Invalid sort direction.");

  return {
    page,
    pageSize: Math.min(requestedPageSize, ADMIN_ARTIST_MAX_PAGE_SIZE),
    search,
    status,
    sort,
    direction,
  };
}

export function paginateAdminArtists(rows, options) {
  const direction = options.direction === "desc" ? -1 : 1;
  const filtered = rows
    .filter((artist) => !options.status || artist.status === options.status)
    .filter((artist) => !options.search || String(artist.name || "").toLowerCase().includes(options.search.toLowerCase()))
    .sort((left, right) => {
      const leftValue = options.sort === "id" ? Number(left.id) : String(left[options.sort] || "").toLowerCase();
      const rightValue = options.sort === "id" ? Number(right.id) : String(right[options.sort] || "").toLowerCase();
      const compared = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
      return compared ? compared * direction : (Number(left.id) - Number(right.id)) * direction;
    });
  const total = filtered.length;
  const offset = (options.page - 1) * options.pageSize;
  return {
    rows: filtered.slice(offset, offset + options.pageSize),
    total,
  };
}

export function adminArtistPage(items, options, total) {
  const totalPages = total ? Math.ceil(total / options.pageSize) : 0;
  return {
    items,
    page: options.page,
    page_size: options.pageSize,
    total,
    total_pages: totalPages,
    has_next: options.page < totalPages,
  };
}
