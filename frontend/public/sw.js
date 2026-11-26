/**
 * ai-net Service Worker
 *
 * Handles push events for background notification delivery and
 * notification click events to open the relevant page.
 */

const SW_VERSION = '1.0.0';

// ── Lifecycle ──────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // Activate the new service worker immediately without waiting for old one to finish
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all open clients immediately
  event.waitUntil(self.clients.claim());
});

// ── Push event handling ────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = {
    title: 'ai-net Notification',
    body: 'You have a new notification.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    url: '/',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      // If JSON parse fails, use the raw text as the body
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/favicon.svg',
    badge: data.badge || '/favicon.svg',
    ...(data.url ? { data: { url: data.url } } : {}),
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification click handling ────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If there's already a window open on that URL, focus it
        for (const client of clientList) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
