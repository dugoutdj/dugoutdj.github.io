// Dugout DJ Service Worker
// Bump APP_VERSION when deploying breaking changes to force cache refresh.
const APP_VERSION = 'v9';
const APP_CACHE = `dugoutdj-app-${APP_VERSION}`;
const IMAGE_CACHE = 'dugoutdj-images-v1';

// On install: pre-cache the minimal app shell (index.html + favicon).
// Hashed /assets/ files are cached on first access instead.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(['/index.html', '/favicon.svg']))
      .then(() => self.skipWaiting())
  );
});

// On activate: delete any caches from old versions.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== APP_CACHE && k !== IMAGE_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // API calls (search, media proxy) — always hit the network; Cloudflare's
  // edge cache handles repeat fetches. Never let the SW cache API responses.
  if (url.pathname.startsWith('/api/')) return;

  // YouTube thumbnails — cache first, 7-day freshness check
  if (url.hostname === 'i.ytimg.com') {
    event.respondWith(imageCacheFirst(request));
    return;
  }

  // Same-origin hashed assets (/assets/...) — cache forever (content hash = immutable)
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(APP_CACHE, request));
    return;
  }

  // Page navigations — always fetch the freshest index.html (it references
  // the newest hashed bundle), falling back to cache only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(APP_CACHE, request));
    return;
  }

  // Other same-origin files — stale-while-revalidate:
  // serve cached version instantly, refresh cache in background.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(APP_CACHE, request));
    return;
  }
});

// Cache first: serve from cache, fetch & store if missing
async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

// Network first: fetch fresh from the network, store in cache, fall back to
// the cached copy if the network is unavailable.
async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('', { status: 408 });
  }
}

// Stale-while-revalidate: return cached response immediately if available,
// then fetch from network in background to keep cache fresh.
async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached ?? networkFetch;
}

// Image cache first — serve from cache, fetch and store on miss
async function imageCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const cache = await caches.open(IMAGE_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}
