function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function isShareableSong(song) {
  return Boolean(song && /^[1-9]\d*$/.test(String(song.id)) && Number.isSafeInteger(Number(song.id)) && song.status === "published");
}

function artworkUrl(value, base) {
  try {
    const url = new URL(value || "/app-assets/images/tesohub-music.png", base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        url.search || /music-audio|\/sign\//i.test(url.pathname)) throw new Error("Private artwork URL");
    return url.href;
  } catch {
    return new URL("/app-assets/images/tesohub-music.png", base).href;
  }
}

export function renderPublicSongPage(song, { shareBaseUrl, webBaseUrl, assetBaseUrl }) {
  if (!isShareableSong(song)) throw new Error("Only published songs can be shared");
  const title = song.title || "TesoHub Music";
  const artist = song.artist_name || "Teso artist";
  const description = `Listen to ${title} by ${artist} on TesoHub Music`;
  const route = `/song/${encodeURIComponent(String(song.id))}`;
  const shareUrl = `${shareBaseUrl.replace(/\/+$/, "")}${route}`;
  const webUrl = `${webBaseUrl.replace(/\/+$/, "")}${route}`;
  const image = artworkUrl(song.cover_image, assetBaseUrl);
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - TesoHub Music</title>
  <link rel="canonical" href="${escapeHtml(shareUrl)}">
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="music.song">
  <meta property="og:site_name" content="TesoHub Music">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:alt" content="${escapeHtml(title)} artwork">
  <meta property="og:url" content="${escapeHtml(shareUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:24px;background:#050506;color:#fff;font-family:system-ui,sans-serif;letter-spacing:0}
    main{max-width:420px;margin:24px auto}.artwork{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px}
    .brand{color:#20e6f3;font-size:14px;font-weight:700;margin-top:24px}h1{font-size:30px;overflow-wrap:anywhere;line-height:1.2;margin:12px 0}
    .artist{color:#ccc;font-size:18px}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}a{color:#20e6f3}
    .button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;border-radius:8px;padding:12px 16px;text-decoration:none;font-weight:700;background:#20e6f3;color:#050506}
    .secondary{background:#18181b;color:#fff;border:1px solid #444}.discover{display:inline-block;margin-top:24px}
  </style>
</head><body><main>
  <img class="artwork" src="${escapeHtml(image)}" alt="${escapeHtml(title)} artwork">
  <p class="brand">TesoHub Music</p><h1>${escapeHtml(title)}</h1><p class="artist">${escapeHtml(artist)}</p>
  <div class="actions"><a class="button" href="${escapeHtml(webUrl)}">Listen in browser</a>
  <a class="button secondary" href="tesohubmusic://song/${song.id}">Open installed app</a></div>
  <a class="discover" href="${escapeHtml(webBaseUrl)}">Discover more music</a>
</main></body></html>`;
}
