// public/firebase-messaging-sw.js
/* Service Worker for Firebase Messaging.
   This file must be served from the site root as /firebase-messaging-sw.js
   For GitHub Pages + create-react-app, put it in the public/ folder so it lands in build root.
*/

// import compat libraries
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Copy the firebaseConfig exactly as in your app:
const firebaseConfig = {
  apiKey: "AIzaSyA-FwUy8WLXiYtT46F0f59gr461cEI_zmo",
  authDomain: "protocol-chat-b6120.firebaseapp.com",
  databaseURL: "https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "protocol-chat-b6120",
  storageBucket: "protocol-chat-b6120.appspot.com",
  messagingSenderId: "969101904718",
  appId: "1:969101904718:web:8dcd0bc8690649235cec1f"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Show a notification for background messages (if payload contains notification or data)
messaging.onBackgroundMessage(function(payload) {
  try {
    const notification = payload.notification || {};
    const data = payload.data || {};
    const title = notification.title || data.title || 'New message';
    const body = notification.body || data.body || '';
    const icon = notification.icon || '/icon-192.png';
    const clickUrl = data.click_action || data.url || '/';

    const options = {
      body,
      icon,
      data: {
        url: clickUrl,
        // copy whole data just in case
        payloadData: data
      }
    };

    // show notification
    self.registration.showNotification(title, options);
  } catch (e) {
    // fail silently in SW but log to console for debugging
    console.error('[SW] onBackgroundMessage error', e);
  }
});

self.addEventListener('notificationclick', function(event) {
  const url = (event.notification && event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        // focus existing tab if URL matches
        try {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        } catch (e) { /* ignore */ }
      }
      // otherwise open a new window/tab
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
