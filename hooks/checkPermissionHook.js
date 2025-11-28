const pool = require('../dbconfig');


const planAccess = {
  // 🧍 NDIS Member Plans
  free: {
    canBrowseEvents: true,
    canBookTickets: true,
    maxCategories: 2,
    aiSearch: 'Basic AI-Powered (limited)',
    priorityUpdates: false,
    canSaveEvents: false
  },
  monthly: {
    canBrowseEvents: true,
    canBookTickets: true,
    maxCategories: 'Unlimited',
    aiSearch: 'Full AI Search',
    priorityUpdates: true,
    canSaveEvents: true
  },
  yearly: {
    canBrowseEvents: true,
    canBookTickets: true,
    maxCategories: 'Unlimited',
    aiSearch: 'Full AI Search',
    priorityUpdates: true,
    canSaveEvents: true
  },

  // 🏢 Company Plans
  starter: {
    canPostEvents: true,
    maxEventPosts: 2,
    ticketType: 'Free Tickets only',
    analytics: 'Basic Analytics',
    support: 'Standard Support',
    canAccessDashboard: true,
    canAccessPaidTicket: false
  },
  growth: {
    canPostEvents: true,
    maxEventPosts: 5,
    ticketType: 'Free and Paid Tickets',
    analytics: 'Standard Analytics',
    support: 'Priority Support',
    canAccessDashboard: true,
    canAccessPaidTicket: true
  },
  professional: {
    canPostEvents: true,
    maxEventPosts: 9999,
    ticketType: 'Free and Paid Tickets',
    analytics: 'Advanced Analytics',
    support: 'Dedicated Support',
    canAccessDashboard: true,
    canAccessPaidTicket: true
  }
};


// =============================================================
// 🧩 GET CURRENT SUBSCRIPTION + ACCESS MAP
// =============================================================
exports.getCurrentAccess = async (req, res, asMiddleware = false) => {
  const user_id = req.user.userId;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT 
        us.subscription_status,
        us.expiry_date,
        sp.name,
        sp.plan_type,
        sp.trial_days,
        sp.features,
        sp.audience_role,
        u.stripe_account_status      -- ✅ add this
      FROM user_subscriptions us
      JOIN subscription_plans sp ON us.plan_id = sp.id
      JOIN users u ON u.id = us.user_id       -- ✅ join users table
      WHERE us.user_id = $1
      ORDER BY us.updated_at DESC
      LIMIT 1;`,
      [user_id]
    );
    client.release();

    let plan;
    if (result.rows.length === 0) {
      // plan = { plan_type: 'free', name: 'Starter Plan', audience_role: 'NDIS Member', subscription_status: 'active' };
      return res.status(403).json({
        status: false,
        message: 'Subscription not found.'
      });
    } else {
      plan = result.rows[0];
    }


    // ❗ If user is Company → Stripe account must be verified (status = 3)
    if (plan.audience_role === "Company") {
      if (plan.stripe_account_status !== 3) {
        return res.status(403).json({
          status: false,
          message: "Your Stripe account is not verified. Please complete your Stripe setup."
        });
      }
    }

    const now = new Date();
    const isExpired = plan.expiry_date && new Date(plan.expiry_date) < now;
    const planKey = plan.plan_type?.toLowerCase() || 'free';
    const currentStatus = isExpired ? 'expired' : plan.subscription_status;
    const audience = plan.audience_role || 'NDIS Member';

    // 🧩 Select planAccess type according to user’s audience
    const availablePlans =
      audience === 'Company'
        ? ['starter', 'growth', 'professional']
        : ['free', 'monthly', 'yearly'];

    const isCompany = audience === 'Company';
    const accessMap = availablePlans.includes(planKey)
      ? planAccess[planKey]
      : planAccess['free']; // fallback

    const data = {
      success: true,
      user_id,
      role: audience,
      plan: {
        name: plan.name,
        type: plan.plan_type,
        status: currentStatus,
        expires_on: plan.expiry_date,
        trial_days: plan.trial_days,
        features: accessMap
      }
    };

    // 🔄 Auto downgrade expired plans
    if (isExpired || currentStatus === 'expired') {
      data.plan = {
        ...data.plan,
        type: isCompany ? 'starter' : 'free',
        name: `${plan.name} (Expired)`,
        features: isCompany ? planAccess['starter'] : planAccess['free'],
        status: 'expired'
      };
    }

    if (asMiddleware) return data;
    return res.status(200).json(data);
  } catch (err) {
    client.release();
    console.error('❌ Error fetching current subscription:', err.message);
    if (asMiddleware)
      throw new Error('Error fetching subscription inside middleware: ' + err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};