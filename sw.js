// Bump CACHE whenever you want to force a clean re-prime of the offline cache.
// (Not strictly required for content updates anymore — see the fetch handler's
// stale-while-revalidate below — but it guarantees a one-time reset on deploy.)
var CACHE = 'breathe-v3';
var ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'sound.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Stale-while-revalidate: serve the cached copy instantly (fast + offline),
// but always fetch a fresh copy in the background and update the cache. The
// next time the app opens it shows the updated files — so future deploys land
// on their own, no reinstall and no version bump required.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(event.request).then(function (cached) {
        var network = fetch(event.request).then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(function () {
          // offline and uncached: fall back to the app shell for navigations
          if (event.request.mode === 'navigate') {
            return cache.match('index.html');
          }
        });
        return cached || network;
      });
    })
  );
});
