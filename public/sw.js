const CACHE = 'eyecom-rc-v5';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Schemes the Cache API accepts - anything else must be ignored
const CACHEABLE_SCHEMES = ['http:', 'https:'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return; // malformed URL — ignore
  }

  // Only cache http/https — reject chrome-extension://, blob://, data://, etc.
  if (!CACHEABLE_SCHEMES.includes(url.protocol)) return;

  // Supabase API calls — always go to network, never cache
  if (url.hostname.includes('supabase.co')) return;

  // Navigation requests — serve app shell from cache, fall back to network
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html')
        .then(cached => cached || fetch(req))
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cache-first strategy for static assets and CDN libraries
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req).then(response => {
        // Only cache valid, same-origin or CORS responses (not opaque)
        if (
          response &&
          response.status === 200 &&
          response.type !== 'opaque' &&
          CACHEABLE_SCHEMES.includes(url.protocol)
        ) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => {
            cache.put(req, clone).catch(() => {}); // silently ignore any put errors
          });
        }
        return response;
      }).catch(() => {
        // Offline fallback — return cached shell
        return caches.match('/index.html');
      });
    })
  );
});
