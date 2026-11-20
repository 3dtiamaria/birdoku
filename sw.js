// Birdoku v13: prefer fresh files while online, cached files while offline.
const CACHE_NAME = 'birdoku-offline-v14';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './generator.js', './worker.js',
  './starters.js', './icon.svg', './icon-192.png', './icon-512.png', './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('birdoku-offline-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      // Bypass HTTP cache so GitHub Pages changes can replace an earlier cached release.
      const fresh = await fetch(event.request, {cache: 'no-cache'});
      if (fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, fresh.clone());
      }
      return fresh;
    } catch (_) {
      return (await caches.match(event.request)) || Response.error();
    }
  })());
});
