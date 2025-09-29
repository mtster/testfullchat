// public/firebase-messaging-sw.js
/* Service Worker for Firebase Messaging.
   This file must be served from the site root as /firebase-messaging-sw.js
   For GitHub Pages + create-react-app, put it in the public/ folder so it lands in build root.
*/

// import compat libraries
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// --- Replace the firebaseConfig object below with the same config used in your app (kept from your build) ---
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

// Handle background messages (compat)
messaging.onBackgroundMessage(function(payload) {
  try {
    // payload may contain notification and/or data
    const notification = payload.notification || {};
    const data = (payload.data && typeof payload.data === 'object') ? payload.data : {};
    const title = notification.title || data.title || "New message";
    const body = notification.body || data.body || "";
    const icon = notification.icon || data.icon || '/icons/icon-192.png';
    const url = (notification.click_action || (data && (data.url || data.click_action))) || '/';

    // Build options
    const options = {
      body: body,
      icon: icon,
      data: { url, payloadData: data },
      // tag will group notifications
      tag: data.tag || notification.tag || 'protocol-chat'
    };

    // Try to show a rich notification
    self.registration.showNotification(title, options);
  } catch (e) {
    // Fail softly but log for debugging
    console.error('[SW] onBackgroundMessage error', e);
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  let url = '/';
  try {
    if (event.notification && event.notification.data && event.notification.data.url) {
      url = event.notification.data.url;
    }
  } catch (e) { /* ignore */ }

  // Focus existing tab if possible, otherwise open new
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        try {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        } catch (e) { /* ignore */ }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
