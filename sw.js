// public/sw.js
self.addEventListener('push', function (event) {
  let payload = { title: 'New message', body: 'You have a new message', data: { url: '/' } };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const title = payload.title || 'New message';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload.data || {},
    tag: payload.tag || undefined,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const clickAction = (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        try {
          if (client.url === clickAction && 'focus' in client) {
            return client.focus();
          }
        } catch(e){}
      }
      if (clients.openWindow) {
        return clients.openWindow(clickAction);
      }
    })
  );
});
