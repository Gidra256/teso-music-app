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

export function renderPublicSongPage(song, { shareBaseUrl, webBaseUrl, assetBaseUrl, androidDownloadUrl = "" }) {
  if (!isShareableSong(song)) throw new Error("Only published songs can be shared");
  const title = song.title || "TesoHub Music";
  const artist = song.artist_name || "Teso artist";
  const description = `Listen to ${title} by ${artist} on TesoHub Music`;
  const route = `/song/${encodeURIComponent(String(song.id))}`;
  const shareUrl = `${shareBaseUrl.replace(/\/+$/, "")}${route}`;
  const webUrl = `${webBaseUrl.replace(/\/+$/, "")}${route}`;
  const image = artworkUrl(song.cover_image, assetBaseUrl);
  const fallback = `${webUrl}?app_fallback=1`;
  const intent = `intent://song/${song.id}#Intent;scheme=tesohubmusic;package=com.tesotunes.app;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  let download = "";
  try {
    const url = new URL(androidDownloadUrl);
    if (url.protocol === "https:" && !url.username && !url.password) download = url.href;
  } catch {}
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
    .secondary{background:#18181b;color:#fff;border:1px solid #444}.discover{display:inline-block;margin-top:24px}[hidden]{display:none!important}
  </style>
</head><body><main>
  <img class="artwork" src="${escapeHtml(image)}" alt="${escapeHtml(title)} artwork">
  <p class="brand">TesoHub Music</p><h1>${escapeHtml(title)}</h1><p class="artist">${escapeHtml(artist)}</p>
  <div class="actions"><a class="button" href="${escapeHtml(webUrl)}">Listen in browser</a>
  <a class="button secondary" id="open-app" hidden data-android-intent="${escapeHtml(intent)}" href="tesohubmusic://song/${song.id}">Open App</a>
  ${download ? `<a class="button secondary" id="get-android-app" hidden href="${escapeHtml(download)}">Get Android App</a>` : ""}</div>
  <script>if (/Android/.test(navigator.userAgent)) { var link = document.getElementById('open-app'); link.href = link.dataset.androidIntent; link.hidden = false; var download = document.getElementById('get-android-app'); if (download) { download.hidden = false; download.onclick = function () { var url = new URL(download.href); return window.confirm(url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' ? 'Open TesoHub Music on Google Play?' : 'Download the TesoHub Music Android Early Access APK? This is a direct APK download, not Google Play. Android may ask you to allow installation from your browser or files app.'); }; } }</script>
  <a class="discover" href="${escapeHtml(webBaseUrl)}">Discover more music</a>
</main></body></html>`;
}
