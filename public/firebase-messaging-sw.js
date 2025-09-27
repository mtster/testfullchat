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

// optional: customize notification click behavior
messaging.onBackgroundMessage(function(payload) {
  // payload.notification already available for compat messaging
  // you can show notification here if needed
  // self.registration.showNotification(payload?.notification?.title || 'New message', {
  //   body: payload?.notification?.body || '',
  //   data: payload?.data || {}
  // });
});

self.addEventListener('notificationclick', function(event) {
  const url = (event.notification && event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        // focus existing tab
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // otherwise open a new window/tab
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
