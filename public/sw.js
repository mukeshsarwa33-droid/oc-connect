// OC Connect Service Worker (PWA Engine for Android & iOS)
// Provides instant app shell loading, offline caching, and PWA installation

const CACHE_NAME = 'oc-connect-v1.1.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/maskable-icon-512.png',
  '/icons/icon.svg'
];

// Install Event — Pre-cache critical application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static app shell');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event — Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event Strategy:
// 1. Dynamic API / SSE calls (/api/*) -> ALWAYS Network directly (never cache live real-time chats or SSE)
// 2. Static Assets (HTML, CSS, JS, Images) -> Stale-While-Revalidate (Instant load from cache + update in background)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Direct bypass for API endpoints, SSE streams, audio calls & uploads
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    return; // Pass through to network
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // If offline and requesting navigation, fallback to cached index.html
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// Push Notification Event (Background Push)
self.addEventListener('push', (event) => {
  let payload = { title: 'OC Connect', body: 'New message received', target: '' };
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (_) {
    payload.body = event.data ? event.data.text() : payload.body;
  }

  const options = {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: payload.target ? `/#chat=${encodeURIComponent(payload.target)}` : '/'
    },
    actions: [
      { action: 'open', title: 'Open Chat 💬' },
      { action: 'close', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'OC Connect', options)
  );
});

// Notification Click Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
