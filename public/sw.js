// Offline support for Zork AI. Plain script (no build step) so it can sit at the site base and use its own scope.
// Rules: same-origin GET only; a request to any other origin (openrouter.ai above all) is never intercepted, so the
// key and the room text go straight from the page to the network. Static assets are cache-first; pages are
// network-first with the cache as the offline fallback. Every cache lookup passes { ignoreVary: true }.
const VERSION = 'zork-ai-v1';
const SCOPE_PATH = new URL(self.registration.scope).pathname; // "/zork-ai/", or "/" on a domain root
const MATCH = { ignoreVary: true };

const isStatic = (pathname) => {
  if (!pathname.startsWith(SCOPE_PATH)) return false;
  const rest = pathname.slice(SCOPE_PATH.length);
  return /^_astro\//.test(rest) || /^[a-z0-9-]+\.z3$/.test(rest) || /^icon-\d+\.png$/.test(rest) || rest === 'manifest.webmanifest';
};

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zork-ai-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return;

  if (isStatic(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(request, MATCH);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) await cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        try {
          const res = await fetch(request);
          if (res.ok) await cache.put(request, res.clone());
          return res;
        } catch (err) {
          const hit = await cache.match(request, MATCH);
          if (hit) return hit;
          throw err;
        }
      }),
    );
  }
});
