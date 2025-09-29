// public/firebase-messaging-sw.js
/* Service Worker for Firebase Messaging.
   This file must be served from the site root (or repo base path) as /firebase-messaging-sw.js
   For GitHub Pages + create-react-app, place in public/ so it lands at the root of the deployed site.
*/

// Import compat libraries (v9 compatibility)
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// --- IMPORTANT: keep this firebaseConfig identical to your app's config above ---
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

// Background message handler (compat)
messaging.onBackgroundMessage(function(payload) {
  try {
    // payload may contain 'notification' and/or 'data'
    const notif = payload && payload.notification ? payload.notification : {};
    const data = payload && payload.data ? payload.data : {};
    const title = notif.title || data.title || "New message";
    const body = notif.body || data.body || "";
    const icon = notif.icon || data.icon || '/icons/icon-192.png';
    const url = (notif.click_action || (data && (data.url || data.click_action))) || '/';

    const options = {
      body,
      icon,
      data: { url, payloadData: data },
      tag: (data && data.tag) || (notif && notif.tag) || 'protocol-chat'
    };

    // Show the notification
    self.registration.showNotification(title, options);
  } catch (e) {
    console.error('[SW] onBackgroundMessage error', e && e.message ? e.message : e);
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
