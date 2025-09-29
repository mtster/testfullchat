// functions/index.js
// Copy this entire file to your repository at: /functions/index.js
// Then commit & push. Your CI (deploy-functions.yml) will deploy it.

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Robust admin init: use FIREBASE_SERVICE_ACCOUNT env in CI if present,
// otherwise fallback to default credentials (firebase deploy).
function initAdmin() {
  if (admin.apps && admin.apps.length) return admin;
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const json = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      admin.initializeApp({
        credential: admin.credential.cert(json),
        databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${json.project_id}.firebaseio.com`
      });
      console.log('[functions] admin initialized from FIREBASE_SERVICE_ACCOUNT');
      return admin;
    }
  } catch (e) {
    console.warn('[functions] FIREBASE_SERVICE_ACCOUNT parse failed, falling back:', e && e.message ? e.message : e);
  }
  try {
    admin.initializeApp();
    console.log('[functions] admin.initializeApp() OK (default credentials)');
  } catch (e) {
    console.warn('[functions] admin.initializeApp() fallback/ignored:', e && e.message ? e.message : e);
  }
  return admin;
}
initAdmin();

/** --- Helpers --- **/

async function writeFunctionLog(entry) {
  try {
    const db = admin.database();
    const ref = db.ref(`functionsLogs/sendMessageNotifications`).push();
    const key = ref.key;
    await ref.set({ ts: Date.now(), ...entry });
    await db.ref(`functionsLogs/sendMessageNotifications/last`).set({ key, ts: Date.now(), summary: entry });
    return key;
  } catch (e) {
    console.warn('[functions] writeFunctionLog failed', e && e.message ? e.message : e);
    return null;
  }
}

async function writePerUserSendAttempt(uid, payloadSummary) {
  try {
    const db = admin.database();
    const ref = db.ref(`users/${uid}/fcmDebug/sendAttempts`).push();
    await ref.set({ ts: Date.now(), ...payloadSummary });
    return ref.key;
  } catch (e) {
    console.warn('[functions] writePerUserSendAttempt failed', e && e.message ? e.message : e);
    return null;
  }
}

/** --- DB-trigger: sendMessageNotifications --- **/
exports.sendMessageNotifications = functions.database
  .ref('/messages/{chatId}/{messageId}')
  .onCreate(async (snap, context) => {
    const message = snap.val();
    const chatId = context.params.chatId;
    const messageId = snap.key;

    if (!message) return null;

    const senderId = message.senderId || null;
    const senderUsername = message.senderUsername || 'Someone';
    const chatName = message.chatName || `Chat ${chatId}`;
    const body = (typeof message.message === 'string' && message.message.length > 0) ? message.message : 'New message';

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
      // fetch full chat node (we normalize participants from either array or map)
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

      if (!participantsRaw) {
        participantsList = [];
      } else if (Array.isArray(participantsRaw)) {
        participantsList = participantsRaw.filter(Boolean);
      } else if (typeof participantsRaw === 'object') {
        participantsList = Object.keys(participantsRaw);
      } else {
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
      const tokenOwnerMap = {};

      for (const uid of participantsList) {
        if (!uid) continue;
        if (uid === senderId) continue;

        try {
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
          console.warn('[functions] failed to process participant', uid, err && err.message ? err.message : err);
        }
      }

      invocationDebug.tokensCollected = tokensToSend.length;
      if (!tokensToSend || tokensToSend.length === 0) {
        await writeFunctionLog(invocationDebug);
        return null;
      }

      const uniqueTokens = Array.from(new Set(tokensToSend));
      invocationDebug.tokensUnique = uniqueTokens.length;

      const payloadNotification = { title: senderUsername, body: body };
      const payloadData = {
        chatId: String(chatId),
        messageId: String(messageId || ''),
        senderId: String(senderId || ''),
        chatName: String(chatName || ''),
        click_action: '/'
      };

      const messageOptions = {
        tokens: uniqueTokens,
        notification: payloadNotification,
        data: payloadData,
        webpush: {
          headers: { TTL: '420' },
          fcmOptions: { link: '/' }
        }
      };

      // pre-send log
      const preSendKey = await writeFunctionLog({ ...invocationDebug, note: 'about-to-send', tokensPreview: uniqueTokens.slice(0, 20) });
      invocationDebug.sendAttemptKey = preSendKey;

      // send
      let response = null;
      try {
        response = await admin.messaging().sendMulticast(messageOptions);
      } catch (sendErr) {
        invocationDebug.error = 'sendMulticast-failed';
        invocationDebug.sendError = (sendErr && sendErr.message) ? sendErr.message : String(sendErr);
        await writeFunctionLog(invocationDebug);
        try { await admin.database().ref(`functionsErrors/sendMulticast`).push({ ts: Date.now(), chatId, messageId, error: invocationDebug.sendError }); } catch (e) {}
        return null;
      }

      invocationDebug.sendResponseSummary = { successCount: response.successCount, failureCount: response.failureCount, multicast: true };
      await writeFunctionLog({ ...invocationDebug, note: 'send-completed', responseSummary: invocationDebug.sendResponseSummary });

      // per-token handling and cleanup
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
          if (ownerUid) {
            writePerUserSendAttempt(ownerUid, perResult).catch(() => {});
          }
          if (!r.success && r.error && r.error.code) {
            const code = String(r.error.code || '');
            if (
              code.includes('registration-token-not-registered') ||
              code.includes('invalid-registration-token') ||
              code.includes('messaging/registration-token-not-registered') ||
              code.includes('messaging/invalid-registration-token') ||
              code.includes('auth/invalid-user-token')
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
        for (const badTok of toRemoveByUid[uidToRemove]) {
          try {
            await admin.database().ref(`users/${uidToRemove}/fcmTokens/${badTok}`).remove();
            console.log('[functions] removed invalid token for uid', uidToRemove);
            await writePerUserSendAttempt(uidToRemove, { ts: Date.now(), removedToken: badTok, note: 'token-removed-by-server' });
          } catch (e) {
            console.warn('[functions] failed to remove invalid token', badTok, e && e.message ? e.message : e);
          }
        }
      }

    } catch (err) {
      invocationDebug.error = (err && err.message) ? err.message : String(err);
      await writeFunctionLog(invocationDebug);
      console.error('[functions] sendMessageNotifications error', invocationDebug.error, err);
    }

    return null;
  });

/** --- HTTP helper: sendTestPush --- **/
exports.sendTestPush = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).send('ok');

  const uid = (req.query && req.query.uid) || (req.body && req.body.uid);
  if (!uid) return res.status(400).json({ ok: false, error: 'Missing uid param' });

  try {
    const db = admin.database();
    const snap = await db.ref(`users/${uid}/fcmTokens`).once('value');
    const tokensObj = snap.val() || {};
    let tokens = Object.keys(tokensObj || {});
    if (!tokens || tokens.length === 0) {
      return res.status(200).json({ ok: true, message: 'No tokens for uid', tokensFound: 0 });
    }

    tokens = Array.from(new Set(tokens));

    const payload = {
      notification: { title: 'Protocol — test push', body: `Test push to ${uid}` },
      data: { test: '1', uid: String(uid) },
      webpush: { headers: { TTL: '420' }, fcmOptions: { link: '/' } }
    };

    const sendResponse = await admin.messaging().sendToDevice(tokens, payload);

    // Write sendAttempt summary to user's debug
    try {
      const pushRef = db.ref(`users/${uid}/fcmDebug/sendAttempts`).push();
      await pushRef.set({ ts: Date.now(), uid, payloadSummary: { tokensSent: tokens.length }, fullResponse: sendResponse });
      await db.ref(`users/${uid}/fcmDebug/lastSend`).set({ ts: Date.now(), tokensSent: tokens.length, successCount: sendResponse.successCount, failureCount: sendResponse.failureCount });
    } catch (e) {
      console.warn('[functions] failed to write sendAttempt', e && e.message ? e.message : e);
    }

    // Remove invalid tokens
    const removed = [];
    if (sendResponse && Array.isArray(sendResponse.results)) {
      sendResponse.results.forEach((r, idx) => {
        if (r && r.error) {
          const code = String(r.error.code || '');
          const tok = tokens[idx];
          if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code.includes('messaging/registration-token-not-registered')) {
            removed.push(tok);
          }
        }
      });
    }
    for (const bad of removed) {
      try { await admin.database().ref(`users/${uid}/fcmTokens/${bad}`).remove(); } catch (e) { /* ignore */ }
    }

    return res.status(200).json({ ok: true, tokensSent: tokens.length, removedTokens: removed, results: sendResponse && sendResponse.results ? sendResponse.results : sendResponse });
  } catch (e) {
    console.error('[functions] sendTestPush error', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});
