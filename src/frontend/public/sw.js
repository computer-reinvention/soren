// SOREN service worker (P4.4) — installability + a minimal offline app
// shell. Deliberately conservative: this is a live agent-monitoring tool,
// so serving *stale data* would be actively misleading. Only the static
// app shell (JS/CSS/fonts/icons) is cached; API calls and the WebSocket
// are always network-only. If the shell is unreachable, cached assets let
// the SPA boot and hand off to OfflineBanner/react-query's own offline
// handling rather than showing a browser error page.
//
// No precache manifest / Workbox: Vite content-hashes every asset
// filename per build, so a runtime "cache what you fetch, evict old
// versions on activate" strategy is simpler than keeping a build-time
// file list in sync, and just as correct — a stale cached asset can only
// ever be served if its exact hashed filename is no longer referenced by
// the current index.html anyway.

const CACHE_NAME = 'soren-shell-v1';
const NEVER_CACHE_PREFIXES = ['/api/', '/ws'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isNeverCache(url) {
  return NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept mutations

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin (fonts CDN etc. aren't used, but be safe)
  if (isNeverCache(url)) return; // API + WebSocket: always network-only, never cached

  if (request.mode === 'navigate') {
    // Network-first for page navigations, falling back to the cached
    // shell so client-side routing can still take over when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          // event.waitUntil keeps the worker alive until this detached
          // cache write finishes — without it, the browser can tear down
          // the worker right after respondWith's promise resolves, and
          // the write silently never happens (caught via live testing:
          // the cache stayed empty across reloads until this was added).
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put('/', response.clone())));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error()))
    );
    return;
  }

  // Static assets (JS/CSS/fonts/icons): cache-first, populate on miss.
  // Safe because Vite content-hashes filenames — a cached response can
  // only be for the exact version currently referenced.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())));
        }
        return response;
      });
    })
  );
});
