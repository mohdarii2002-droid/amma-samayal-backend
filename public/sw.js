// Amma Samayal service worker — makes the app installable + offline shell
const CACHE = 'amma-samayal-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // never cache POST/PATCH
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;     // API always from network (live data)
  // network-first, fall back to cache (so updates show, offline still works)
  e.respondWith(
    fetch(req).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
  );
});
