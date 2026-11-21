const CACHE_NAME = 'horror-museum-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/museum.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {});
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache or hijack API requests, socket.io, or admin routes
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/admin') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Network first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone)).catch(() => {});
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
