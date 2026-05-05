// Minimal service worker for Finance Tracker.
// Strategy:
//   - /api/* and /events: never cache, always go to network.
//   - Static assets (/, /assets/*, /icon.svg, /favicon.ico, /manifest.webmanifest):
//     network-first with stale-while-revalidate fallback.
//
// Bump the cache version when you change SW logic to invalidate old caches.

const CACHE = 'ft-v1';
const STATIC_PATHS = ['/', '/icon.svg', '/favicon.ico', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC_PATHS).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Network-only for the API and SSE
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/events')) {
    return;
  }

  // GETs only for caching; same-origin only
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? caches.match('/'))),
  );
});
