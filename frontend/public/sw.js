const CACHE_NAME = 'newsflow-v1';
const STATIC_ASSETS = ['/', '/home', '/manifest.json', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // API isteklerini cache'leme, sadece network'e git
  if (request.url.includes('/api/') || request.url.includes(':8080')) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).catch(() => caches.match('/')))
  );
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'NewsFlow', body: 'Yeni haberler var!' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
    })
  );
});
