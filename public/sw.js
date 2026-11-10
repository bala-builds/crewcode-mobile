// CrewCode service worker: cache-first for the app shell only.
// API calls (/api) always go to the network - project state is never cached offline.
// Bump CACHE_VERSION on every deploy; old caches are deleted on activate so the fixed URL never strands users on an old build.
const CACHE = 'crewcode-2026-11-10-1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api')) return; // always live
  // Shell from cache; network fallback keeps the fixed URL fresh after a new deploy activates.
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
