// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

// If you set FIREBASE_SERVICE_ACCOUNT (the JSON string) as a repo secret, the deploy workflow
// should set it in the environment. Try to initialize admin with that if present.
function initAdmin() {
  if (admin.apps && admin.apps.length) return admin;

  // If service account JSON provided in env (stringified)
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      const parsed = typeof saJson === "string" ? JSON.parse(saJson) : saJson;
      admin.initializeApp({
        credential: admin.credential.cert(parsed),
        databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${parsed.project_id}.firebaseio.com`
      });
      console.log("[functions] admin initialized from FIREBASE_SERVICE_ACCOUNT");
      return admin;
    }
  } catch (e) {
    console.warn("[functions] FIREBASE_SERVICE_ACCOUNT parse failed, falling back to default init", e && e.message ? e.message : e);
  }

  // Fallback to default (when deployed with Application Default Credentials e.g. in Firebase-hosted environment)
  try {
    admin.initializeApp();
    console.log("[functions] admin initialized with default credentials");
  } catch (e) {
    console.warn("[functions] admin.init default failed (maybe already init) -", e && e.message ? e.message : e);
  }
  return admin;
}

initAdmin();

// Helper: write a sendAttempt entry in RTDB for audit
async function recordSendAttempt(uid, payload, tokens, adminResponse) {
  try {
    const db = admin.database();
    const pushRef = db.ref(`users/${uid}/fcmDebug/sendAttempts`).push();
    const pushId = pushRef.key;
    const entry = {
      ts: Date.now(),
      payload,
      tokens,
      responseSummary: {
        successCount: (adminResponse && adminResponse.successCount) || null,
        failureCount: (adminResponse && adminResponse.failureCount) || null
      },
      fullResponse: adminResponse || null
    };
    await pushRef.set(entry);
    // Also set a lastSend marker
    await db.ref(`users/${uid}/fcmDebug/lastSend`).set({ pushId, ts: Date.now(), successCount: entry.responseSummary.successCount, failureCount: entry.responseSummary.failureCount });
    return pushId;
  } catch (e) {
    console.warn("[functions] recordSendAttempt failed", e && e.message ? e.message : e);
    return null;
  }
}

// Main HTTP endpoint
exports.sendTestPush = functions.https.onRequest(async (req, res) => {
  // Basic CORS: allow all origins. Adjust if you want to restrict.
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).send("ok");

  const uid = (req.query && req.query.uid) || (req.body && req.body.uid);
  if (!uid) {
    return res.status(400).json({ ok: false, error: "Missing uid query param or body.uid" });
  }

  try {
    const db = admin.database();
    const tokensSnap = await db.ref(`users/${uid}/fcmTokens`).once("value");
    const tokensObj = tokensSnap.val() || {};
    const tokens = Object.keys(tokensObj);

    if (!tokens || tokens.length === 0) {
      return res.status(200).json({ ok: true, message: "No tokens found for uid", tokensFound: 0 });
    }

    // Compose payload: notification (for native display) + webpush options + fallback data
    const payload = {
      notification: {
        title: "Protocol — Test notification",
        body: `Test push to uid ${uid}`,
        icon: "/icons/icon-192.png"
      },
      webpush: {
        headers: {
          TTL: "420"
        },
        fcm_options: {
          link: "/" // where clicking the notification should open
        }
      },
      data: {
        // additional data accessible in service worker on push
        title: "Protocol — Test",
        body: `Test push to uid ${uid}`,
        url: "/"
      }
    };

    // Use sendToDevice which accepts array of tokens
    const sendResponse = await admin.messaging().sendToDevice(tokens, payload);

    // Analyze response, remove invalid tokens
    const removedTokens = [];
    if (sendResponse && Array.isArray(sendResponse.results)) {
      sendResponse.results.forEach((r, idx) => {
        const err = r.error;
        if (err) {
          const tok = tokens[idx];
          const code = (err.code || "").toString();
          // Common errors indicating token must be removed
          if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token") || code.includes("auth/invalid-user-token") || code.includes("messaging/registration-token-not-registered")) {
            removedTokens.push(tok);
          }
        }
      });
    }

    // Try to clean up invalid tokens
    for (const badTok of removedTokens) {
      try {
        await db.ref(`users/${uid}/fcmTokens/${badTok}`).remove();
        console.log(`[functions] removed invalid token ${badTok}`);
      } catch (e) {
        console.warn("[functions] failed to remove invalid token", badTok, e && e.message ? e.message : e);
      }
    }

    // record attempt in DB for audit
    await recordSendAttempt(uid, payload, tokens, sendResponse);

    // Return the admin response for debugging
    return res.status(200).json({ ok: true, tokensSent: tokens.length, removedTokens, results: sendResponse && sendResponse.results ? sendResponse.results : sendResponse });
  } catch (e) {
    console.error("[functions] sendTestPush error", e && e.message ? e.message : e, e);
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});
