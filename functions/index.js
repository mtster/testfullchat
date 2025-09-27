const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Cloud Function: send push notifications when a new message is written.
 *
 * Trigger: /messages/{chatId}/{messageId}
 *
 * Behavior:
 * - Reads chat participants at /chats/{chatId}/participants (expected map {uid: true})
 * - For each participant (except sender) fetches /users/{uid}/online and /users/{uid}/fcmTokens
 * - If user is online (online === true) or user's activeChat === chatId, skip sending push
 * - Sends FCM multicast to the remaining tokens, and cleans up invalid tokens reported by FCM response
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

      // collect tokens per-user and remember location to remove bad tokens if necessary
      const tokenOwnerMap = {}; // token -> uid

      for (const uid of Object.keys(participants)) {
        if (uid === senderId) continue; // skip sender

        try {
          const [userSnap, activeSnap] = await Promise.all([
            admin.database().ref(`users/${uid}`).once('value'),
            admin.database().ref(`users/${uid}/activeChat`).once('value'),
            // NOTE: we could also read users/{uid}/online but it's inside userSnap
          ]);
          const userVal = userSnap.exists() ? userSnap.val() : null;
          const activeChat = activeSnap.exists() ? activeSnap.val() : null;
          if (!userVal) continue;
          // skip if user is online or has this chat open
          if (userVal.online === true) {
            continue;
          }
          if (activeChat && String(activeChat) === String(chatId)) continue;

          // get fcmTokens object
          const fcmTokens = userVal.fcmTokens || null;
          if (fcmTokens) {
            for (const t of Object.keys(fcmTokens)) {
              tokensToSend.push(t);
              tokenOwnerMap[t] = uid;
            }
          }
        } catch (err) {
          console.warn("Failed to process participant", uid, err);
        }
      }

      if (!tokensToSend || tokensToSend.length === 0) return null;

      // build payload
      const payload = {
        notification: {
          title: senderUsername,
          body: body,
        },
        data: {
          chatId: String(chatId),
          messageId: String(snap.key || ""),
          senderId: String(senderId || ""),
          chatName: String(chatName || "")
        }
      };

      // send multicast
      try {
        const response = await admin.messaging().sendMulticast({
          tokens: tokensToSend,
          notification: payload.notification,
          data: payload.data,
        });

        // handle cleanup of invalid tokens
        if (response && response.responses && Array.isArray(response.responses)) {
          const toRemoveByUid = {};
          response.responses.forEach((r, idx) => {
            const tok = tokensToSend[idx];
            if (!r.success) {
              const err = r.error;
              if (err && (err.code === 'messaging/invalid-registration-token' || err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-argument')) {
                const owner = tokenOwnerMap[tok];
                if (owner) {
                  toRemoveByUid[owner] = toRemoveByUid[owner] || [];
                  toRemoveByUid[owner].push(tok);
                }
              }
            }
          });
          // remove bad tokens
          for (const uid of Object.keys(toRemoveByUid)) {
            for (const badTok of toRemoveByUid[uid]) {
              try {
                await admin.database().ref(`users/${uid}/fcmTokens/${badTok}`).remove();
              } catch (e) {
                console.warn("Failed to remove bad token", badTok, e);
              }
            }
          }
        }
      } catch (err) {
        console.error("sendMulticast error", err);
      }
    } catch (err) {
      console.error("sendMessageNotifications error", err);
    }

    return null;
  });
