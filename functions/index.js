// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Initialize admin SDK robustly
function initAdmin() {
  if (admin.apps && admin.apps.length) return admin;
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const json = typeof process.env.FIREBASE_SERVICE_ACCOUNT === "string"
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      admin.initializeApp({
        credential: admin.credential.cert(json),
        databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${json.project_id}.firebaseio.com`
      });
      console.log("[functions] admin initialized from FIREBASE_SERVICE_ACCOUNT");
      return admin;
    }
  } catch (e) {
    console.warn("[functions] FIREBASE_SERVICE_ACCOUNT parse failed, falling back:", e && e.message ? e.message : e);
  }
  try {
    admin.initializeApp();
    console.log("[functions] admin.initializeApp() OK (default credentials)");
  } catch (e) {
    console.warn("[functions] admin.initializeApp() fallback/ignored:", e && e.message ? e.message : e);
  }
  return admin;
}

initAdmin();

/** Helper: push a function invocation log visible in RTDB (easier to inspect from mobile) */
async function writeFunctionLog(entry) {
  try {
    const db = admin.database();
    const ref = db.ref(`functionsLogs/sendMessageNotifications`).push();
    const key = ref.key;
    await ref.set({ ts: Date.now(), ...entry });
    // also set lastInvocation for quick lookup
    await db.ref(`functionsLogs/sendMessageNotifications/last`).set({ key, ts: Date.now(), summary: entry });
    return key;
  } catch (e) {
    console.warn("[functions] writeFunctionLog failed", e && e.message ? e.message : e);
    return null;
  }
}

/** Helper: append a per-user sendAttempt entry under users/{uid}/fcmDebug/sendAttempts */
async function writePerUserSendAttempt(uid, payloadSummary) {
  try {
    const db = admin.database();
    const ref = db.ref(`users/${uid}/fcmDebug/sendAttempts`).push();
    await ref.set({ ts: Date.now(), ...payloadSummary });
    return ref.key;
  } catch (e) {
    console.warn("[functions] writePerUserSendAttempt failed", e && e.message ? e.message : e);
    return null;
  }
}

/**
 * Trigger: onCreate /messages/{chatId}/{messageId}
 * Behavior preserved: skip sender, skip online users and users with activeChat === chatId
 * Sends multicast to tokens and removes invalid tokens; now supports participants arrays or maps,
 * writes function-level logs and per-user sendAttempt entries for mobile inspection.
 */
exports.sendMessageNotifications = functions.database
  .ref("/messages/{chatId}/{messageId}")
  .onCreate(async (snap, context) => {
    const message = snap.val();
    const chatId = context.params.chatId;
    const messageId = snap.key;

    if (!message) return null;

    const senderId = message.senderId || null;
    const senderUsername = message.senderUsername || "Someone";
    const chatName = message.chatName || `Chat ${chatId}`;
    const body = (typeof message.message === 'string' && message.message.length > 0) ? message.message : 'New message';

    // We'll collect debug info to write into functionsLogs
    const invocationDebug = {
      triggeredFor: { chatId, messageId, senderId, senderUsername },
      participantsRaw: null,
      participantsCount: 0,
      participantsParsed: [],
      tokensCollected: 0,
      tokensUnique: 0,
      sendAttemptKey: null,
      sendResponseSummary: null,
      error: null
    };

    try {
      // fetch chat participants (can be array or object)
      const chatSnap = await admin.database().ref(`chats/${chatId}`).once('value');
      const chatVal = chatSnap.exists() ? chatSnap.val() : null;
      if (!chatVal) {
        invocationDebug.error = 'no-chat-record';
        await writeFunctionLog(invocationDebug);
        return null;
      }

      const participantsRaw = chatVal.participants;
      invocationDebug.participantsRaw = participantsRaw;
      let participantsList = [];

      // Normalize participants: support array or object/map
      if (!participantsRaw) {
        participantsList = [];
      } else if (Array.isArray(participantsRaw)) {
        participantsList = participantsRaw.filter(Boolean);
      } else if (typeof participantsRaw === 'object') {
        // if it's an object with keys = uid and value = true, use keys
        participantsList = Object.keys(participantsRaw);
      } else {
        // unexpected shape
        invocationDebug.error = 'participants-unexpected-shape';
        await writeFunctionLog(invocationDebug);
        participantsList = [];
      }

      invocationDebug.participantsCount = participantsList.length;
      invocationDebug.participantsParsed = participantsList;

      if (participantsList.length === 0) {
        await writeFunctionLog(invocationDebug);
        return null;
      }

      const tokensToSend = [];
      const tokenOwnerMap = {}; // token -> uid

      // For each participant resolve whether we should send
      for (const uid of participantsList) {
        if (!uid) continue;
        if (uid === senderId) continue; // skip sender

        try {
          const [userSnap, activeSnap] = await Promise.all([
            admin.database().ref(`users/${uid}`).once('value'),
            admin.database().ref(`users/${uid}/activeChat`).once('value'),
          ]);
          const userVal = userSnap.exists() ? userSnap.val() : null;
          const activeChat = activeSnap && activeSnap.exists() ? activeSnap.val() : null;
          if (!userVal) continue;

          // skip if online or has this chat open
          if (userVal.online === true) continue;
          if (activeChat && String(activeChat) === String(chatId)) continue;

          const fcmTokens = userVal.fcmTokens || null;
          if (fcmTokens) {
            for (const t of Object.keys(fcmTokens)) {
              if (!t) continue;
              tokensToSend.push(t);
              tokenOwnerMap[t] = uid;
            }
          }
        } catch (err) {
          console.warn("[functions] failed to process participant", uid, err && err.message ? err.message : err);
        }
      }

      invocationDebug.tokensCollected = tokensToSend.length;

      if (!tokensToSend || tokensToSend.length === 0) {
        await writeFunctionLog(invocationDebug);
        return null;
      }

      // dedupe tokens
      const uniqueTokens = Array.from(new Set(tokensToSend));
      invocationDebug.tokensUnique = uniqueTokens.length;

      // Build payload (web-friendly)
      const payloadNotification = {
        title: senderUsername,
        body: body
      };

      const payloadData = {
        chatId: String(chatId),
        messageId: String(messageId || ""),
        senderId: String(senderId || ""),
        chatName: String(chatName || ""),
        click_action: "/"
      };

      const messageOptions = {
        tokens: uniqueTokens,
        notification: payloadNotification,
        data: payloadData,
        webpush: {
          headers: { TTL: "420" },
          fcmOptions: { link: "/" }
        }
      };

      // write a pre-send function log
      const preSendKey = await writeFunctionLog({ ...invocationDebug, note: "about-to-send", tokensPreview: uniqueTokens.slice(0,20) });
      invocationDebug.sendAttemptKey = preSendKey;

      // send multicast
      let response = null;
      try {
        response = await admin.messaging().sendMulticast(messageOptions);
      } catch (sendErr) {
        invocationDebug.error = 'sendMulticast-failed';
        invocationDebug.sendError = (sendErr && sendErr.message) ? sendErr.message : String(sendErr);
        await writeFunctionLog(invocationDebug);

        // record error node for quick inspection
        try {
          await admin.database().ref(`functionsErrors/sendMulticast`).push({ ts: Date.now(), chatId, messageId, error: invocationDebug.sendError });
        } catch (e) { /* ignore */ }

        return null;
      }

      // Attach response summary to invocation debug and record
      invocationDebug.sendResponseSummary = {
        successCount: response.successCount,
        failureCount: response.failureCount,
        multicast: true
      };
      await writeFunctionLog({ ...invocationDebug, note: "send-completed", responseSummary: invocationDebug.sendResponseSummary });

      // For each result, write a per-user small sendAttempt entry and collect tokens to remove
      const toRemoveByUid = {};
      if (response && Array.isArray(response.responses)) {
        response.responses.forEach((r, idx) => {
          const token = uniqueTokens[idx];
          const ownerUid = tokenOwnerMap[token] || null;
          const perResult = {
            ts: Date.now(),
            token,
            success: !!r.success,
            error: r.error ? (r.error.message || r.error.toString()) : null,
            code: r.error ? (r.error.code || null) : null,
            chatId,
            messageId
          };
          // write per-user attempt (best-effort)
          if (ownerUid) {
            writePerUserSendAttempt(ownerUid, perResult).catch(() => {});
          }
          // If r.error indicates invalid registration, schedule removal
          if (!r.success && r.error && r.error.code) {
            const code = String(r.error.code || "");
            if (
              code.includes("registration-token-not-registered") ||
              code.includes("invalid-registration-token") ||
              code.includes("messaging/registration-token-not-registered") ||
              code.includes("messaging/invalid-registration-token") ||
              code.includes("auth/invalid-user-token")
            ) {
              if (ownerUid) {
                toRemoveByUid[ownerUid] = toRemoveByUid[ownerUid] || [];
                toRemoveByUid[ownerUid].push(token);
              }
            }
          }
        });
      }

      // Remove invalid tokens
      for (const uidToRemove of Object.keys(toRemoveByUid)) {
        const toks = toRemoveByUid[uidToRemove];
        for (const badTok of toks) {
          try {
            await admin.database().ref(`users/${uidToRemove}/fcmTokens/${badTok}`).remove();
            console.log("[functions] removed invalid token for uid", uidToRemove);
            // also record removal in the user's debug
            await writePerUserSendAttempt(uidToRemove, { ts: Date.now(), removedToken: badTok, note: "token-removed-by-server" });
          } catch (e) {
            console.warn("[functions] failed to remove invalid token", badTok, e && e.message ? e.message : e);
          }
        }
      }

    } catch (err) {
      invocationDebug.error = (err && err.message) ? err.message : String(err);
      await writeFunctionLog(invocationDebug);
      console.error("[functions] sendMessageNotifications error", invocationDebug.error, err);
    }

    return null;
  });
