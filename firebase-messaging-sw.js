// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js');

// Init with your firebase config (you can keep these empty placeholders and rely on server-side sends)
// It's safe to include only the messagingSenderId, but provide full config is ok.
const firebaseConfig = {
apiKey: "REPLACE_WITH_YOUR_API_KEY",
authDomain: "REPLACE",
databaseURL: "REPLACE",
projectId: "REPLACE",
storageBucket: "REPLACE",
messagingSenderId: "REPLACE",
appId: "REPLACE"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Background handler — show a notification when received in background.
messaging.onBackgroundMessage(function(payload) {
try {
const {title, body, icon, data} = payload.notification || {};
const options = {
body: body || payload.data?.body || '',
icon: icon || '/icons/icon-192x192.png',
data: data || payload.data || {},
tag: payload.data?.tag || undefined,
renotify: false
};
self.registration.showNotification(title || 'New message', options);
} catch (e) {
console.error('SW: Failed to show background notification', e, payload);
}
});

self.addEventListener('notificationclick', function(event) {
event.notification.close();
// Focus or open the app
event.waitUntil(
clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
if (clientList.length > 0) {
let client = clientList[0];
for (let i = 0; i < clientList.length; i++) {
if (clientList[i].focused) client = clientList[i];
}
return client.focus();
}
if (clients.openWindow) {
// Optional: navigate to a specific chat path if payload contains chatId
const url = '/';
return clients.openWindow(url);
}
})
);
});
