import { initializeApp } from "firebase/app";
import { getFirestore, serverTimestamp } from "firebase/firestore";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyA-FwUy8WLXiYtT46F0f59gr461cEI_zmo",
  authDomain: "protocol-chat-b6120.firebaseapp.com",
  databaseURL: "https://protocol-chat-b6120-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "protocol-chat-b6120",
  storageBucket: "protocol-chat-b6120.appspot.com",
  messagingSenderId: "969101904718",
  appId: "1:969101904718:web:8dcd0bc8690649235cec1f"
};

const app = initializeApp(firebaseConfig);

// Firestore
const db = getFirestore(app);

// Realtime Database
const rtdb = getDatabase(app);

export { app, db, rtdb, serverTimestamp };
