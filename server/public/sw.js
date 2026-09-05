const CACHE_NAME = 'oc-notify-v1';
const ASSETS = [
  '/',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// ─── Install ────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ───────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch (cache-first for assets, network-first for API) ─
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Don't cache API or socket requests
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

// ─── Notification Click ─────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const promptId = e.notification.data?.promptId;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes('/') && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', promptId });
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow('/');
    })
  );
});

// ─── Push (for future Web Push support) ─────────────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;

  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'opencode', {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'opencode-push',
      data: data.data,
      requireInteraction: true,
      vibrate: [200, 100, 200]
    })
  );
});
