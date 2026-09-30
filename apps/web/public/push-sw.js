// Web Push for the service worker (imported by the Workbox-generated sw.js).
// A push carries { title, body, url, tag } from the server; tapping the notification focuses an
// open window of the app (and takes it to `url`) or opens a new one.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Expense Tracker', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Expense Tracker';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  // Only ever open pages of this app.
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === target.origin);
      if (open) {
        await open.focus();
        if ('navigate' in open) return open.navigate(target.href);
        return undefined;
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
