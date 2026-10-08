const CACHE_NAME = "tesohub-music-shell-v2";
const APP_SHELL_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/tesohub-music.png",
  "/icons/tesohub-192.png",
  "/icons/tesohub-512.png",
];
const PRIVATE_PATH_PREFIXES = [
  "/api/",
  "/admin/",
  "/admin-api/",
  "/media/",
  "/uploads/",
];
const AUDIO_VIDEO_EXTENSIONS = [".aac", ".flac", ".m4a", ".mp3", ".mp4", ".ogg", ".wav", ".webm"];
const CACHEABLE_DESTINATIONS = new Set(["font", "image", "script", "style", "worker"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function shouldBypassCache(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;
  if (request.destination === "audio" || request.destination === "video") return true;
  if (PRIVATE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return true;

  const pathname = url.pathname.toLowerCase();
  return AUDIO_VIDEO_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cachedOffline = await caches.match("/offline.html");
    return cachedOffline || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cachedResponse || (await networkPromise) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypassCache(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
