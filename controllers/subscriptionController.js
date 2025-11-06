const pool = require('../dbconfig');

exports.getSubscriptionPlans = async (req, res) => { 
  try {
 //const userId = req.user.userId;
   // Ensure user is authenticated
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    // Get role from authenticated user
    const userRole = req.user.role;

    if (!userRole) {
      return res.status(400).json({ success: false, message: 'User role not found in token' });
    }

    // normalize role name
    const normalizedRole = userRole.toLowerCase() === 'company' ? 'Company' : 'NDIS Member';

    const query = `
      SELECT 
        id,
        name,
        plan_type,
        price,
        currency,
        description,
        features,
        duration,
        trial_days,
        is_active,
        created_at,
        updated_at
      FROM subscription_plans
      WHERE audience_role = $1
        AND is_active = TRUE
      ORDER BY 
        CASE plan_type 
          WHEN 'free' THEN 1
          WHEN 'starter' THEN 2
          WHEN 'monthly' THEN 3
          WHEN 'growth' THEN 4
          WHEN 'professional' THEN 5
          WHEN 'yearly' THEN 6
          ELSE 7
        END;
    `;

    const client = await pool.connect();
    const { rows } = await client.query(query, [normalizedRole]);
    client.release();

    return res.status(200).json({
      success: true,
      role: normalizedRole,
      count: rows.length,
      plans: rows,
    });
  } catch (err) {
    console.error('❌ Error fetching subscription plans:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching subscription plans',
      error: err.message,
    });
  }
};


exports.startFreeTrial = async (req, res) => {
  const user_id = req.user.userId; // from JWT
  const { plan_id, platform = 'web' } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 0️⃣ Check if user has already taken any free trial
    const existingTrial = await client.query(
      `SELECT 1 FROM user_subscriptions 
      WHERE user_id = $1 AND subscription_status = 'trial'`,
      [user_id]
    );

    if (existingTrial.rows.length > 0) {
      client.release();
      return res.status(400).json({
        success: false,
        message: 'You have already used your free trial.',
      });
    }


    // 1️⃣ Get plan info
    const planRes = await client.query(
      'SELECT trial_days FROM subscription_plans WHERE id=$1',
      [plan_id]
    );
    if (planRes.rows.length === 0)
      return res.status(400).json({ success: false, message: 'Invalid plan.' });

    const trial_days = planRes.rows[0].trial_days;
    if (trial_days <= 0)
      return res.status(400).json({ success: false, message: 'This plan has no trial.' });

    const now = new Date();
    const expiry_date = new Date(now.getTime() + trial_days * 24 * 60 * 60 * 1000);

    // 2️⃣ Insert a "free trial payment" record
    const fakeTransactionId = `TRIAL-${user_id}-${Date.now()}`;
    const paymentRes = await client.query(
      `INSERT INTO payments (user_id, plan_id, platform, provider, transaction_id, amount, currency, payment_status)
       VALUES ($1, $2, $3, 'free_trial', $4, 0.0, 'USD', 'free_trial')
       RETURNING id;`,
      [user_id, plan_id, platform, fakeTransactionId]
    );
    const payment_id = paymentRes.rows[0].id;

    // 3️⃣ Create or reuse a subscription group
    let groupRes = await client.query(
      `SELECT id FROM user_subscription_groups WHERE user_id=$1 AND plan_id=$2 AND group_status='active'`,
      [user_id, plan_id]
    );
    let group_id = groupRes.rows.length
      ? groupRes.rows[0].id
      : (
          await client.query(
            `INSERT INTO user_subscription_groups
             (user_id, plan_id, platform, provider, group_status, auto_renew)
             VALUES ($1,$2,$3,'free_trial','active',FALSE)
             RETURNING id;`,
            [user_id, plan_id, platform]
          )
        ).rows[0].id;

    // 4️⃣ Log the renewal entry
    await client.query(
      `INSERT INTO user_subscription_renewals
       (subscription_group_id, renewal_number, transaction_id, payment_id, start_date, expiry_date, renewal_status, auto_renew)
       VALUES ($1, 1, $2, $3, NOW(), $4, 'success', FALSE);`,
      [group_id, fakeTransactionId, payment_id, expiry_date]
    );

    // 5️⃣ Create/update subscription record
    await client.query(
      `INSERT INTO user_subscriptions
       (user_id, plan_id, platform, subscription_status, start_date, expiry_date, next_renewal_date, auto_renew, last_payment_id)
       VALUES ($1, $2, $3, 'trial', NOW(), $4, $4, FALSE, $5)
       ON CONFLICT (user_id, plan_id) DO UPDATE
         SET subscription_status='trial', expiry_date=$4, next_renewal_date=$4, auto_renew=FALSE, last_payment_id=$5, updated_at=NOW();`,
      [user_id, plan_id, platform, expiry_date, payment_id]
    );

    await client.query('COMMIT');
    client.release();

    return res.status(200).json({
      success: true,
      message: `Free trial started for ${trial_days} days`,
      expires_on: expiry_date,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Error starting trial:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};


exports.getCurrentSubscription = async (req, res) => {
  const user_id = req.user.userId; // from JWT

  const client = await pool.connect();
  try {
    const query = `
      SELECT 
        us.subscription_status,
        us.expiry_date,
        sp.id AS plan_id,
        sp.name AS plan_name,
        sp.plan_type,
        sp.price,
        sp.currency,
        sp.description,
        sp.features,
        sp.duration,
        sp.trial_days,
        sp.audience_role,
        sp.is_active
      FROM user_subscriptions us
      JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE us.user_id = $1
      ORDER BY us.updated_at DESC
      LIMIT 1;
    `;
    const result = await client.query(query, [user_id]);

    // 🧩 If user has no subscription → default to free
    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No active subscription found. Defaulting to free plan.',
        plan: {
          id: null,
          name: 'Starter Plan',
          type: 'free',
          price: 0.0,
          currency: 'USD',
          description: 'Browse and view all listed events with limited access.',
          features: [
            'Browse and view all listed events',
            'Select up to 2 event categories',
            'Booking disabled (Upgrade prompt shown)',
            'Basic AI-powered search with limited queries'
          ],
          duration: null,
          trial_days: 0,
          status: 'active',
          role: 'NDIS Member'
        }
      });
    }

    const plan = result.rows[0];

    // ⏰ Check if plan is expired
    const now = new Date();
    const isExpired = plan.expiry_date && new Date(plan.expiry_date) < now;
    const currentStatus = isExpired ? 'expired' : plan.subscription_status;

    // 🧾 Response structure
    return res.status(200).json({
      success: true,
      message: 'Current subscription fetched successfully.',
      user_id,
      role: plan.audience_role,
      plan: {
        id: plan.plan_id,
        name: plan.plan_name,
        type: plan.plan_type,
        price: plan.price,
        currency: plan.currency,
        description: plan.description,
        features: plan.features,
        duration: plan.duration,
        trial_days: plan.trial_days,
        expires_on: plan.expiry_date,
        status: currentStatus,
        is_active: plan.is_active
      }
    });
  } catch (err) {
    console.error('❌ Error fetching current subscription:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching current subscription',
      error: err.message
    });
  } finally {
    client.release();
  }
};