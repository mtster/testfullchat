// firebase-messaging-sw.js
// Service Worker for Firebase Messaging (use exact filename at site root)

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

messaging.onBackgroundMessage(function(payload) {
  try {
    const notification = payload.notification || {};
    const title = notification.title || (payload.data && payload.data.title) || "New message";
    const options = {
      body: notification.body || (payload.data && payload.data.body) || "",
      icon: notification.icon || "/icons/icon-192.png",
      data: payload.data || {}
    };
    self.registration.showNotification(title, options);
  } catch (err) {
    console.error("onBackgroundMessage error", err);
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  event.waitUntil(
    clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(clientList) {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
