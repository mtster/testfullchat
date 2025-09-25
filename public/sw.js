self.addEventListener('push', function(event) {
  let payload = {};
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    try {
      payload = JSON.parse(event.data.text());
    } catch (e2) {
      payload = { title: 'New message', body: event.data ? event.data.text() : 'You have a new notification' };
    }
  }

  const title = payload.title || 'New message';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    data: payload.data || { url: payload.url || '/' },
    vibrate: [100, 50, 100]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const urlToOpen = (event.notification && event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if ('focus' in client) {
          // If already open, focus it and navigate
          client.focus();
          try {
            client.postMessage({ type: 'notification-click', url: urlToOpen });
          } catch (e) {}
          return client.navigate ? client.navigate(urlToOpen) : Promise.resolve();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
