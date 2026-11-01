/* NetLab offline service worker (generated at build time from sw/sw-template.js). */
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const CACHE = 'netlab-' + VERSION;
const CONFIG_CACHE = 'netlab-config';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      try {
        const cfg = await caches.open(CONFIG_CACHE);
        await cfg.add('./config.json');
      } catch (e) {
        /* config is optional */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('netlab-') && k !== CACHE && k !== CONFIG_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Teacher settings: try the network briefly, fall back to the last copy we saw.
  if (url.pathname.endsWith('/config.json')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CONFIG_CACHE);
        try {
          const res = await withTimeout(fetch(req, { cache: 'no-store' }), 3000);
          if (res.ok) await cache.put('./config.json', res.clone());
          return res;
        } catch (e) {
          const hit = await cache.match('./config.json');
          return hit || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        }
      })(),
    );
    return;
  }

  // Page loads: always answer from the cached app shell so a flaky network never blocks a student.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const shell = await cache.match(new URL('./', self.registration.scope).href);
        if (shell) return shell;
        return fetch(req);
      })(),
    );
    return;
  }

  // Built assets: cache first.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && url.pathname.includes('/assets/')) cache.put(req, res.clone());
      return res;
    })(),
  );
});
