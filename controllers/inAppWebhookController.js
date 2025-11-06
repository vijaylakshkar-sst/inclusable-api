// controllers/webhookController.js
const pool = require('../dbconfig');

/**
 * Webhook endpoint for handling in-app purchase renewals, cancellations, refunds, and expirations.
 */
exports.handleInAppWebhook = async (req, res) => {
  const payload = req.body;

  // Basic payload validation
  if (!payload || !payload.event_type || !payload.user_id || !payload.plan_id) {
    return res.status(400).json({ success: false, message: 'Invalid webhook payload.' });
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
  } = payload;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Insert into payments table
    const paymentResult = await client.query(
      `
      INSERT INTO payments (
        user_id, plan_id, platform, provider, transaction_id, amount, currency, payment_status, receipt_data
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (transaction_id) DO UPDATE 
        SET payment_status = EXCLUDED.payment_status,
            updated_at = NOW()
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
        event_type === 'REFUND' ? 'refunded' : 'success',
        JSON.stringify(payload.receipt_data || {}),
      ]
    );
    const payment_id = paymentResult.rows[0]?.id;

    // 2️⃣ Find or create user_subscription_group
    let groupResult = await client.query(
      'SELECT id FROM user_subscription_groups WHERE user_id=$1 AND plan_id=$2 AND group_status=$3 LIMIT 1',
      [user_id, plan_id, 'active']
    );

    let group_id;
    if (groupResult.rows.length === 0) {
      const newGroup = await client.query(
        `INSERT INTO user_subscription_groups
         (user_id, plan_id, platform, provider, group_status, auto_renew)
         VALUES ($1,$2,$3,$4,'active',TRUE) RETURNING id;`,
        [user_id, plan_id, platform || 'web', provider || 'iap']
      );
      group_id = newGroup.rows[0].id;
    } else {
      group_id = groupResult.rows[0].id;
    }

    // 3️⃣ Calculate renewal dates
    const now = new Date();
    const expiry_date =
      renewal_info?.expiry_date ? new Date(renewal_info.expiry_date) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const next_renewal_date =
      renewal_info?.next_renewal_date ? new Date(renewal_info.next_renewal_date) : new Date(expiry_date.getTime());

    // 4️⃣ Handle each event_type
    switch (event_type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
        // Get renewal count
        const countRes = await client.query(
          'SELECT COUNT(*) FROM user_subscription_renewals WHERE subscription_group_id=$1',
          [group_id]
        );
        const renewal_number = Number(countRes.rows[0].count) + 1;

        // Insert renewal record
        await client.query(
          `INSERT INTO user_subscription_renewals
           (subscription_group_id, renewal_number, transaction_id, payment_id, start_date, expiry_date, renewal_status, auto_renew)
           VALUES ($1,$2,$3,$4,NOW(),$5,'success',TRUE);`,
          [group_id, renewal_number, transaction_id, payment_id, expiry_date]
        );

        // Update main user_subscriptions
        await client.query(
          `INSERT INTO user_subscriptions
           (user_id, plan_id, platform, subscription_status, start_date, expiry_date, next_renewal_date, auto_renew, last_payment_id)
           VALUES ($1,$2,$3,'active',NOW(),$4,$5,TRUE,$6)
           ON CONFLICT (user_id, plan_id) DO UPDATE
           SET subscription_status='active',
               expiry_date=$4,
               next_renewal_date=$5,
               auto_renew=TRUE,
               last_payment_id=$6,
               updated_at=NOW();`,
          [user_id, plan_id, platform || 'web', expiry_date, next_renewal_date, payment_id]
        );

        break;

      case 'CANCELLATION':
        await client.query(
          `UPDATE user_subscription_groups SET group_status='cancelled', auto_renew=FALSE, cancelled_at=NOW() WHERE id=$1;`,
          [group_id]
        );
        await client.query(
          `UPDATE user_subscriptions SET subscription_status='cancelled', auto_renew=FALSE, updated_at=NOW()
           WHERE user_id=$1 AND plan_id=$2;`,
          [user_id, plan_id]
        );
        break;

      case 'EXPIRE':
        await client.query(
          `UPDATE user_subscription_groups SET group_status='expired', auto_renew=FALSE, ended_at=NOW() WHERE id=$1;`,
          [group_id]
        );
        await client.query(
          `UPDATE user_subscriptions SET subscription_status='expired', auto_renew=FALSE, updated_at=NOW()
           WHERE user_id=$1 AND plan_id=$2;`,
          [user_id, plan_id]
        );
        break;

      case 'REFUND':
        await client.query(
          `UPDATE payments SET payment_status='refunded', updated_at=NOW() WHERE transaction_id=$1;`,
          [transaction_id]
        );
        await client.query(
          `UPDATE user_subscriptions SET subscription_status='cancelled', auto_renew=FALSE, updated_at=NOW()
           WHERE user_id=$1 AND plan_id=$2;`,
          [user_id, plan_id]
        );
        break;

      default:
        console.warn(`⚠️ Unknown event type: ${event_type}`);
        break;
    }

    await client.query('COMMIT');
    client.release();

    console.log(`✅ Webhook processed: ${event_type} for user ${user_id}`);
    return res.status(200).json({ success: true, message: 'Webhook processed successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Webhook error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
