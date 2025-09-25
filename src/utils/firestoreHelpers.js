// src/utils/firestoreHelpers.js
// Contains helper functions and example queries for the DB schema described.

import { db, serverTimestamp } from "../firebase";
import {
  collection,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  arrayUnion
} from "firebase/firestore";

/*
Schemas (Firestore collections):

users:
  - id (doc id)
  - username (string)
  - password (string)  <-- per your request (visible to admin)
  - chatIds (array of chat IDs)

chats:
  - id (doc id)
  - chatName (string)
  - participants (array of user IDs)
  - lastMessage (string)
  - timestamp (timestamp)

messages:
  - id (doc id)
  - chatId (string)
  - senderId (user id)
  - message (string)
  - timestamp (timestamp)
*/

export {
  addDoc, doc, setDoc, updateDoc, getDoc, getDocs, query, where, orderBy, limit, onSnapshot, arrayUnion
};
