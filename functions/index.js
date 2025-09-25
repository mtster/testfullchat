const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

// Trigger on messages added under /messages/{chatId}/{messageId}
exports.sendMessageNotifications = functions.database
  .ref("/messages/{chatId}/{messageId}")
  .onCreate(async (snap, context) => {
    const message = snap.val();
    const chatId = context.params.chatId;

    if (!message) return null;

    const senderId = message.senderId || null;
    const senderUsername = message.senderUsername || "Someone";
    const body = (message.message && String(message.message).slice(0, 200)) || "New message";
    const timestamp = message.timestamp || Date.now();

    // read chat participants
    const chatSnap = await admin.database().ref(`chats/${chatId}`).once("value");
    const chat = chatSnap.val() || {};
    const participants = Array.isArray(chat.participants) ? chat.participants : (chat.participants ? Object.values(chat.participants) : []);

    if (!participants || participants.length === 0) return null;

    // gather tokens for participants except sender
    let tokens = [];

    for (const uid of participants) {
      if (!uid || uid === senderId) continue;

      // skip if user is present (app is open)
      const presenceSnap = await admin.database().ref(`presence/${uid}`).once("value");
      const isPresent = !!presenceSnap.val();
      if (isPresent) continue;

      const tokenSnap = await admin.database().ref(`fcmTokens/${uid}`).once("value");
      const tokenObj = tokenSnap.val() || {};
      const userTokens = Object.keys(tokenObj).filter(Boolean);
      tokens = tokens.concat(userTokens);
    }

    if (!tokens || tokens.length === 0) return null;

    // build notification payload
    const payload = {
      notification: {
        title: `${senderUsername}`,
        body: body,
      },
      data: {
        chatId: String(chatId),
        messageId: String(snap.key),
        senderId: String(senderId || ""),
        senderUsername: String(senderUsername || ""),
        timestamp: String(timestamp)
      }
    };

    // send in chunks (multicast limit 500 tokens)
    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      try {
        const response = await admin.messaging().sendMulticast({
          tokens: chunk,
          notification: payload.notification,
          data: payload.data,
        });
        // Optionally: handle responses, clean up invalid tokens
        if (response.failureCount) {
          const responses = response.responses;
          for (let j = 0; j < responses.length; j++) {
            if (!responses[j].success) {
              const err = responses[j].error;
              // If token invalid, remove it from DB
              if (err && (err.code === 'messaging/invalid-registration-token' || err.code === 'messaging/registration-token-not-registered')) {
                const badToken = chunk[j];
                // Find owner (reverse lookup not stored) — best-effort: remove from all fcmTokens entries
                // This is expensive; you can optimize by storing token->uid mapping.
                const tokensRef = admin.database().ref('fcmTokens');
                const snapshot = await tokensRef.once('value');
                const all = snapshot.val() || {};
                for (const userId in all) {
                  if (all[userId] && all[userId][badToken]) {
                    await admin.database().ref(`fcmTokens/${userId}/${badToken}`).remove();
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("sendMulticast error", err);
      }
    }

    return null;
  });
