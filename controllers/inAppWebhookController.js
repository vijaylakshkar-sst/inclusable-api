// controllers/webhookController.js
const pool = require('../dbconfig');
/**
 * Webhook endpoint for handling in-app purchase renewals, cancellations, refunds, and expirations.
 */
exports.handleInAppWebhook = async (req, res) => {
  const payload = req.body;

  // Validate payload
  if (!payload || !payload.event_type || !payload.user_id || !payload.plan_id) {
    return res.status(400).json({ status: false, message: 'Invalid webhook payload.' });
  }

  const {
    user_id,
    plan_id,
    platform,
    provider,
    transaction_id,
    amount,
    currency = 'USD',
    event_type,
    renewal_info,
    originalTransactionId
  } = payload;

  // ❗ Process ONLY INITIAL_PURCHASE
  if (event_type !== "INITIAL_PURCHASE") {
    return res.status(200).json({
      status: true,
      message: `Ignored event: ${event_type}. Only INITIAL_PURCHASE is processed.`,
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Insert Payment
    const paymentResult = await client.query(
      `
      INSERT INTO payments (
        user_id, plan_id, platform, provider, transaction_id, amount, currency, payment_status, receipt_data
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (transaction_id) DO NOTHING
      RETURNING id;
      `,
      [
        user_id,
        plan_id,
        platform || 'web',
        provider || 'iap',
        transaction_id,
        amount || 0.0,
        currency,
        'success',
        JSON.stringify(payload.receipt_data || {}),
      ]
    );

    const payment_id = paymentResult.rows[0]?.id;

    // 2️⃣ Create subscription group
    const newGroup = await client.query(
      `INSERT INTO user_subscription_groups
       (user_id, plan_id, platform, provider, group_status, auto_renew)
       VALUES ($1,$2,$3,$4,'active',TRUE)
       RETURNING id;`,
      [user_id, plan_id, platform || 'web', provider || 'iap']
    );

    const group_id = newGroup.rows[0].id;

    // 3️⃣ Dates
    const now = new Date();
    const expiry_date =
      renewal_info?.expiry_date
        ? new Date(renewal_info.expiry_date)
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 4️⃣ Insert subscription
    await client.query(
      `INSERT INTO user_subscriptions
       (user_id, plan_id, platform, subscription_status, start_date, expiry_date, next_renewal_date, auto_renew, last_payment_id, originalTransactionId)
       VALUES ($1,$2,$3,'active',NOW(),$4,$4,TRUE,$5,$6)
       ON CONFLICT (user_id, plan_id) DO UPDATE
       SET subscription_status='active',
           expiry_date=$4,
           next_renewal_date=$4,
           auto_renew=TRUE,
           last_payment_id=$5,
           updated_at=NOW();`,
      [user_id, plan_id, platform || 'web', expiry_date, payment_id, originalTransactionId]
    );

    await client.query("COMMIT");
    client.release();

    return res.status(200).json({
      status: true,
      message: "INITIAL_PURCHASE processed successfully",
    });

  } catch (err) {
    await client.query("ROLLBACK");
    client.release();
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ status: false, message: err.message });
  }
};


// Utility: decode JWT segment
function decodePart(part) {
  let normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  return JSON.parse(Buffer.from(normalized, "base64").toString());
}

exports.AppleWebhook = async (req, res) => {
 try {
    const payload = req.body;

    if (!payload.signedPayload) {
      console.log("❌ Missing signedPayload");
      return res.status(400).send("Missing signedPayload");
    }

    // 👉 Split JWT
    const parts = payload.signedPayload.split(".");
    const mainDecoded = decodePart(parts[1]);

    console.log("📌 MAIN DECODED PAYLOAD:", mainDecoded);

    if (!mainDecoded.data) {
      console.log("❌ Invalid 'data' field");
      return res.send("OK");
    }

    const data = mainDecoded.data;

    let status = "active";
    const notificationType = mainDecoded.notificationType;
    const notificationSubType = mainDecoded.subtype || null;

    // Map statuses
    if (notificationType === "EXPIRED") status = "expired";
    if (notificationSubType === "AUTO_RENEW_DISABLED") status = "cancelled";

    // Check transaction
    if (!data.signedTransactionInfo) {
      console.log("❌ Missing signedTransactionInfo");
      return res.send("OK");
    }

    const transParts = data.signedTransactionInfo.split(".");
    const decodedTrans = decodePart(transParts[1]);

    console.log("🧾 MAIN TRANSACTION:", decodedTrans);

    // Extract fields
    let originalTransactionId = decodedTrans.originalTransactionId;
    let transactionId = decodedTrans.transactionId;
    let productId = decodedTrans.productId;
    let expiresDate = decodedTrans.expiresDate
      ? new Date(decodedTrans.expiresDate).toISOString()
      : null;

    // Check Renewal Info (upgrade/downgrade)
    if (data.signedRenewalInfo) {
      const renewalParts = data.signedRenewalInfo.split(".");
      const decodedRenewal = decodePart(renewalParts[1]);

      console.log("🔄 RENEWAL INFO:", decodedRenewal);

      if (decodedRenewal.autoRenewProductId) {
        productId = decodedRenewal.autoRenewProductId;
      }
    }

    // Get subscription plan by productId (YOU MUST MAP THIS)
    const planQuery = await pool.query(
      "SELECT id, duration, audience_role FROM subscription_plans WHERE productId=$1 LIMIT 1",
      [productId]
    );

    if (planQuery.rows.length === 0) {
      console.log("❌ No plan found for:", productId);
      return res.send("OK");
    }

    const plan = planQuery.rows[0];


    // Get User subscription 
    const UserSubscriptionQuery = await pool.query(
      "SELECT * FROM user_subscriptions WHERE originalTransactionId=$1 LIMIT 1",
      [originalTransactionId]
    );

    if (UserSubscriptionQuery.rows.length > 0) {
      console.log("❌ No Use SUbscription for:", originalTransactionId);
      return res.send("OK");
    }

    const UserSubscription = UserSubscriptionQuery.rows[0];
console.log(UserSubscription,'UserSubscription');

    // ==========================================
    // 🚀 Insert / Update user_subscription_group
    // ==========================================
    let groupResult = await pool.query(
      `
      INSERT INTO user_subscription_groups 
      (user_id, plan_id, platform, provider, group_status, auto_renew)
      VALUES ($1, $2, 'ios', 'apple', 'active', true)
      ON CONFLICT (user_id, plan_id) DO UPDATE SET updated_at = NOW()
      RETURNING *;
      `,
      [UserSubscription.user_id, plan.id] /* ORIGINAL_TRANSACTION_ID used as user_id placeholder */
    );

    const group = groupResult.rows[0];

    // ==========================================
    // 🚀 Insert / Update main user_subscriptions
    // ==========================================
    await pool.query(
      `
      INSERT INTO user_subscriptions 
      (user_id, plan_id, platform, subscription_status, start_date, expiry_date, auto_renew)
      VALUES ($1, $2, 'ios', $3, NOW(), $4, true)
      ON CONFLICT (user_id, plan_id)
      DO UPDATE SET 
          subscription_status = EXCLUDED.subscription_status,
          expiry_date = EXCLUDED.expiry_date,
          updated_at = NOW();
      `,
      [UserSubscription.user_id, plan.id, status, expiresDate]
    );

    // ==========================================
    // 🚀 Insert renewal history (one log per transaction)
    // ==========================================
    await pool.query(
      `
      INSERT INTO user_subscription_renewals
      (subscription_group_id, renewal_number, transaction_id, start_date, expiry_date, renewal_status)
      VALUES 
      (
        $1,
        (SELECT COUNT(*) FROM user_subscription_renewals WHERE subscription_group_id=$1)+1,
        $2,
        NOW(),
        $3,
        $4
      )
      ON CONFLICT (transaction_id) DO NOTHING;
      `,
      [group.id, transactionId, expiresDate, status]
    );

    console.log("✅ Subscription processed successfully");
    return res.send("OK");
  } catch (err) {
    console.error("❌ Apple Webhook Error:", err);
    return res.status(500).send("Error");
  }
};



// ================================
// 🔥 =============Google play Webhook===========
// ================================




// Decode Pub/Sub BASE64 message
function decodeBase64Json(str) {
    return JSON.parse(Buffer.from(str, "base64").toString());
}


exports.GoogleWebhook = async (req, res) => {
    try {
        console.log("🤖 Google Play Webhook Received");

        const pubsubBody = req.body;

        if (!pubsubBody.message || !pubsubBody.message.data) {
            console.log("❌ Invalid Pub/Sub format");
            return res.status(400).send("Invalid message");
        }

        // RTDN notification (decoded from Pub/Sub)
        const decoded = decodeBase64Json(pubsubBody.message.data);

        console.log("📦 Google Notification:", decoded);       

        const pkg = decoded.packageName;
        const eventMillis = Number(decoded.eventTimeMillis);
        const subscription = decoded.subscriptionNotification;

        if (!subscription) {
            console.log("❌ No subscriptionNotification");
            return res.send("OK");
        }

        const notificationType = subscription.notificationType;
        const purchaseToken = subscription.purchaseToken;
        const productId = subscription.subscriptionId;

        let status = "active";

        // Google notification type mapping
        switch (notificationType) {
            case 1: // SUBSCRIPTION_RECOVERED
            case 2: // SUBSCRIPTION_RENEWED
                status = "active";
                break;

            case 3: // SUBSCRIPTION_CANCELED
            case 5: // SUBSCRIPTION_ON_HOLD
            case 12: // SUBSCRIPTION_REVOKED
                status = "cancelled";
                break;

            case 4: // SUBSCRIPTION_PURCHASED
                status = "active";
                break;

            case 13: // SUBSCRIPTION_EXPIRED
                status = "expired";
                break;

            default:
                status = "active";
        }

        // ================================
        // 🔥 FETCH GOOGLE PURCHASE DETAILS
        // ================================
        // ❗ We do NOT verify signature (following your Apple logic)

        const expiryDate = decoded?.testNotification
            ? null
            : new Date(eventMillis).toISOString();

        // ================================
        // 🔥 Find Plan based on productId
        // ================================
        const planResult = await pool.query(
            "SELECT id FROM subscription_plans WHERE plan_type=$1 LIMIT 1",
            [productId]
        );

        if (planResult.rows.length === 0) {
            console.log("❌ No plan found for product:", productId);
            return res.send("OK");
        }

        const plan = planResult.rows[0];

        // ================================
        // 🔥 Insert / Update Subscription Group
        // ================================
        const group = await pool.query(
            `
            INSERT INTO user_subscription_groups
            (user_id, plan_id, platform, provider, group_status, auto_renew)
            VALUES ($1, $2, 'android', 'google', 'active', true)
            ON CONFLICT (user_id, plan_id)
            DO UPDATE SET updated_at = NOW()
            RETURNING *;
        `,
            [purchaseToken, plan.id]
        );

        const groupId = group.rows[0].id;

        // ================================
        // 🔥 Insert / Update Main Subscription Entry
        // ================================
        await pool.query(
            `
            INSERT INTO user_subscriptions 
            (user_id, plan_id, platform, subscription_status, start_date, expiry_date, auto_renew)
            VALUES ($1, $2, 'android', $3, NOW(), $4, true)
            ON CONFLICT (user_id, plan_id)
            DO UPDATE SET 
                subscription_status = EXCLUDED.subscription_status,
                expiry_date = EXCLUDED.expiry_date,
                updated_at = NOW();
        `,
            [purchaseToken, plan.id, status, expiryDate]
        );

        // ================================
        // 🔥 Insert Renewal Log
        // ================================
        await pool.query(
            `
            INSERT INTO user_subscription_renewals
            (subscription_group_id, renewal_number, transaction_id, start_date, expiry_date, renewal_status)
            VALUES
            (
                $1,
                (SELECT COUNT(*) FROM user_subscription_renewals WHERE subscription_group_id=$1)+1,
                $2,
                NOW(),
                $3,
                $4
            )
            ON CONFLICT (transaction_id) DO NOTHING;
        `,
            [groupId, purchaseToken, expiryDate, status]
        );

        console.log("✅ Google subscription processed successfully");
        return res.send("OK");
    } catch (err) {
        console.error("❌ Google Webhook Error:", err);
        return res.status(500).send("Server Error");
    }
}