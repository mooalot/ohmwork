// Service worker: network-first with cache fallback. Online you always get
// the newest questions/code; offline everything still works from cache.
const CACHE = 'ohmwork-v1';

const CORE = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './vendor/katex.min.css',
  './vendor/katex.min.js',
  './js/app.js',
  './js/question.js',
  './js/figures.js',
  './js/sim.js',
  './js/state.js',
  './js/topics.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(CORE);
      // best-effort: pre-cache the question bank for offline lessons
      const topics = ['dc-basics', 'network-theorems', 'capacitors-rc', 'inductors-rl',
        'rlc-resonance', 'ac-phasors', 'filters-bode', 'diodes', 'bjt', 'mosfets-opamps'];
      await Promise.allSettled(topics.map((t) => c.add(`./data/questions/${t}.json`)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: false }))
  );
});
