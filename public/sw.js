// OC Connect Service Worker (PWA Engine for Android, iOS & Desktop)
// Provides instant offline app shell loading, lockscreen/tray push notifications, and background sync

const CACHE_NAME = 'oc-connect-v1.2.0';
const STATIC_ASSETS = [
  '/',
  '/?source=pwa',
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

// Activate Event — Clean up old caches and take control immediately
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
// 1. /api/* and non-GET requests -> ALWAYS direct Network (never cache live real-time chats, SSE, audio calls)
// 2. Navigation requests (PWA launch, index.html) -> Cache-First with ignoreSearch fallback for sub-10ms standalone launch even with ?source=pwa
// 3. Static Assets (CSS, JS, icons) -> Stale-While-Revalidate with ignoreSearch
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Direct bypass for API endpoints, SSE streams, audio calls & uploads
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    return; // Pass through directly to network
  }

  // Standalone PWA launch / Navigation request: Instant cache response prevents offline dinosaur / load errors
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        if (cached) {
          // Revalidate in background to keep app up-to-date
          fetch(event.request).then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              caches.open(CACHE_NAME).then((c) => c.put(event.request, networkRes));
            }
          }).catch(() => {});
          return cached;
        }

        // Try /index.html or / fallback
        return caches.match('/index.html', { ignoreSearch: true }).then((indexCached) => {
          if (indexCached) return indexCached;
          return fetch(event.request).catch(() => caches.match('/', { ignoreSearch: true }));
        });
      })
    );
    return;
  }

  // Static Assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// Push Notification Event (Lockscreen & Notification Bar on Android/iOS/Desktop)
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
    vibrate: [200, 100, 200],
    tag: payload.target ? `oc_${payload.target}` : 'oc_chat',
    renotify: true,
    data: {
      targetUsername: payload.target || '',
      url: payload.target ? `/?chat=${encodeURIComponent(payload.target)}` : '/'
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

// Notification Click Handler — Focuses window or launches PWA to exact chat
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || (data.targetUsername ? `/?chat=${encodeURIComponent(data.targetUsername)}` : '/');

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (data.targetUsername) {
            client.postMessage({
              type: 'OPEN_CHAT_TARGET',
              target: data.targetUsername,
              title: data.title || data.targetUsername,
              isChannel: data.isChannel || false,
              isGroup: data.isGroup || false,
              groupName: data.groupName || ''
            });
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
