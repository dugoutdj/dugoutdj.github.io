// Dugout DJ Service Worker
// Bump APP_VERSION when deploying breaking changes to force cache refresh.
const APP_VERSION = 'v4';
const APP_CACHE = `dugoutdj-app-${APP_VERSION}`;
const IMAGE_CACHE = 'dugoutdj-images-v1';
const IMAGE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

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

  // index.html and other same-origin files — network first, fall back to cache
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(APP_CACHE, request));
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

// Network first: try network, fall back to cache on failure
async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// Image cache first with 7-day expiry stored in response headers
async function imageCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    const cachedAt = cached.headers.get('x-cached-at');
    if (cachedAt && Date.now() - Number(cachedAt) < IMAGE_MAX_AGE) {
      return cached;
    }
  }
  try {
    const response = await fetch(request);
    if (response.ok || response.status === 0) {
      // Clone and add a timestamp header so we can expire old entries
      const headers = new Headers(response.headers);
      headers.set('x-cached-at', String(Date.now()));
      const stamped = new Response(await response.blob(), { status: response.status, headers });
      const cache = await caches.open(IMAGE_CACHE);
      cache.put(request, stamped);
      return stamped;
    }
    return response;
  } catch {
    return cached || new Response('', { status: 408 });
  }
}
