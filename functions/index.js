// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Initialize admin SDK.
// If you deploy with Application Default Credentials via firebase deploy this will succeed;
// if you prefer to initialize with a service-account JSON in CI you can set FIREBASE_SERVICE_ACCOUNT
// in your workflow and initialize accordingly (see comments below).
function initAdmin() {
  if (admin.apps && admin.apps.length) return admin;

  // Try env-based service account JSON (optional: set FIREBASE_SERVICE_ACCOUNT as JSON string)
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
    console.warn("[functions] FIREBASE_SERVICE_ACCOUNT parse/init failed, will fallback:", e && e.message ? e.message : e);
  }

  // Default initialization (expected when deployed via Firebase CLI / GitHub Actions with proper permissions)
  try {
    admin.initializeApp();
    console.log("[functions] admin.initializeApp() OK (default credentials)");
  } catch (err) {
    console.warn("[functions] admin.initializeApp() fallback failed or already initialized:", err && err.message ? err.message : err);
  }
  return admin;
}

initAdmin();

/**
 * recordSendAttempt - persistent audit trail in RTDB
 */
async function recordSendAttempt(uid, payload, tokens, sendResponse) {
  try {
    const db = admin.database();
    const pushRef = db.ref(`users/${uid}/fcmDebug/sendAttempts`).push();
    const key = pushRef.key;
    const entry = {
      ts: Date.now(),
      payload,
      tokens: tokens || [],
      responseSummary: {
        successCount: sendResponse && typeof sendResponse.successCount === 'number' ? sendResponse.successCount : null,
        failureCount: sendResponse && typeof sendResponse.failureCount === 'number' ? sendResponse.failureCount : null
      },
      fullResponse: sendResponse || null
    };
    await pushRef.set(entry);
    await db.ref(`users/${uid}/fcmDebug/lastSend`).set({
      pushId: key,
      ts: Date.now(),
      successCount: entry.responseSummary.successCount,
      failureCount: entry.responseSummary.failureCount
    });
    return key;
  } catch (e) {
    console.warn("[functions] recordSendAttempt failed", e && e.message ? e.message : e);
    return null;
  }
}

/**
 * Cloud Function trigger:
 * - Trigger: onCreate(/messages/{chatId}/{messageId})
 * - Behavior: read participants, skip online/active users, gather tokens, send multicast,
 *   remove invalid tokens, record debug.
 */
exports.sendMessageNotifications = functions.database
  .ref("/messages/{chatId}/{messageId}")
  .onCreate(async (snap, context) => {
    const message = snap.val();
    const chatId = context.params.chatId;

    if (!message) return null;

    const senderId = message.senderId || null;
    const senderUsername = message.senderUsername || "Someone";
    const chatName = message.chatName || `Chat ${chatId}`;
    const body = (typeof message.message === 'string' && message.message.length > 0) ? message.message : 'New message';

    try {
      // fetch chat participants
      const chatSnap = await admin.database().ref(`chats/${chatId}/participants`).once('value');
      const participants = chatSnap.exists() ? chatSnap.val() : null;
      if (!participants) return null;

      const tokensToSend = [];
      const tokenOwnerMap = {}; // token -> uid

      // iterate participants and collect tokens unless user is online / in-active chat
      for (const uid of Object.keys(participants)) {
        if (uid === senderId) continue; // skip sender

        try {
          // Read user profile and activeChat in parallel
          const [userSnap, activeSnap] = await Promise.all([
            admin.database().ref(`users/${uid}`).once('value'),
            admin.database().ref(`users/${uid}/activeChat`).once('value'),
          ]);
          const userVal = userSnap.exists() ? userSnap.val() : null;
          const activeChat = activeSnap && activeSnap.exists() ? activeSnap.val() : null;
          if (!userVal) continue;

          // skip if user is online or has this chat open
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
          console.warn("[functions] failed to evaluate participant", uid, err && err.message ? err.message : err);
        }
      }

      if (!tokensToSend || tokensToSend.length === 0) return null;

      // Deduplicate tokens (some clients may re-register and produce duplicates)
      const uniqueTokens = Array.from(new Set(tokensToSend));

      // Compose message payload suitable for web push + mobile
      const payload = {
        notification: {
          title: senderUsername,
          body: body,
        },
        data: {
          chatId: String(chatId),
          messageId: String(snap.key || ""),
          senderId: String(senderId || ""),
          chatName: String(chatName || ""),
          click_action: "/" // legacy click_action
        },
        // webpush options help browsers display/route clicks properly
        webpush: {
          headers: {
            TTL: "420"
          },
          fcmOptions: {
            link: "/" // clicking should open / (or you can set to chat URL)
          }
        }
      };

      // Send multicast via admin.messaging.sendMulticast
      try {
        const response = await admin.messaging().sendMulticast({
          tokens: uniqueTokens,
          notification: payload.notification,
          data: payload.data,
          webpush: payload.webpush
        });

        // Record send audit in RTDB
        await recordSendAttempt(senderId || 'unknown', payload, uniqueTokens, response);

        // handle cleanup of invalid tokens
        if (response && response.responses && Array.isArray(response.responses)) {
          const toRemoveByUid = {};
          response.responses.forEach((r, idx) => {
            const tok = uniqueTokens[idx];
            if (!r.success) {
              const err = r.error;
              if (err && err.code) {
                const errCode = String(err.code || "");
                // remove tokens for codes that indicate the registration is invalid/unregistered
                if (
                  errCode.includes('registration-token-not-registered') ||
                  errCode.includes('invalid-registration-token') ||
                  errCode.includes('messaging/registration-token-not-registered') ||
                  errCode.includes('messaging/invalid-registration-token') ||
                  errCode.includes('auth/invalid-user-token')
                ) {
                  const owner = tokenOwnerMap[tok];
                  if (owner) {
                    toRemoveByUid[owner] = toRemoveByUid[owner] || [];
                    toRemoveByUid[owner].push(tok);
                  }
                } else {
                  // log other error codes for debug
                  console.warn("[functions] push error (non-delete) for token", tok, errCode, err && err.message ? err.message : err);
                }
              } else {
                console.warn("[functions] push error (no code) for token", tok, err && err.message ? err.message : err);
              }
            }
          });

          // remove invalid tokens
          for (const uid of Object.keys(toRemoveByUid)) {
            for (const badTok of toRemoveByUid[uid]) {
              try {
                await admin.database().ref(`users/${uid}/fcmTokens/${badTok}`).remove();
                console.log("[functions] removed invalid token for uid", uid, badTok);
              } catch (e) {
                console.warn("[functions] failed to remove invalid token", badTok, e && e.message ? e.message : e);
              }
            }
          }
        }
      } catch (err) {
        console.error("[functions] sendMulticast error", err && err.message ? err.message : err);
        // Optionally record failure in RTDB for debugging
        try {
          const db = admin.database();
          const pushRef = db.ref(`functionsErrors/sendMulticast`).push();
          await pushRef.set({ ts: Date.now(), error: (err && err.message) ? err.message : String(err) });
        } catch (e) {
          console.warn("[functions] failed to record sendMulticast error", e && e.message ? e.message : e);
        }
      }
    } catch (err) {
      console.error("[functions] sendMessageNotifications error", err && err.message ? err.message : err);
      // don't rethrow; function should return null
    }

    return null;
  });
