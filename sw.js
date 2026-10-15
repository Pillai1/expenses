// Offline support: always try the network, keep a cached copy for when there is none.
const CACHE = 'expenses-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './zip.js',
  './xlsx.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Network first so updates show up straight away; fall back to the cache when offline or slow.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000));
      const res = await Promise.race([fetch(req), timeout]);
      if (res.ok) {
        cache.put(req, res.clone());
        return res;
      }
      // Site down or taken offline: keep the installed copy working.
      return (await cache.match(req, { ignoreSearch: true })) || res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
