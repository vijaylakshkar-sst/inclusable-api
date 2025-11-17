const { getCurrentAccess } = require('../hooks/checkPermissionHook');

// 🧠 Friendly upgrade messages for NDIS Members
const ndisFeatureMessages = {
  canBookTickets: 'Please upgrade your account to book events.',
  canSaveEvents: 'Upgrade to save or favorite events.',
  aiSearch: 'Upgrade to access full AI-powered event search.',
  priorityUpdates: 'Upgrade to get priority event updates.',
  maxCategories: 'Upgrade to explore unlimited event categories.'
};

// 🏢 Friendly upgrade messages for Company users
const companyFeatureMessages = {
  canPostEvents: 'Upgrade to post more events per month.',
  maxEventPosts: 'Upgrade to increase your monthly event posting limit.',
  ticketType: 'Upgrade to sell paid tickets for your events.',
  analytics: 'Upgrade to access advanced analytics tools.',
  support: 'Upgrade to get priority or dedicated support.',
  canAccessPaidTicket: 'Upgrade to unlock paid ticketing options.',
  canAccessDashboard: 'Upgrade to access the full business dashboard.'
};

// ✅ Middleware factory for checking feature access
exports.checkFeatureAccess = (feature) => async (req, res, next) => {
  try {
    // Fetch user's current plan & access
    const subscription = await getCurrentAccess(req, res, true);

    if (
      !subscription ||
      !subscription.plan ||
      !subscription.plan.features ||
      typeof subscription.plan.features[feature] === 'undefined'
    ) {
      return res.status(403).json({
        status: false,
        message: 'Unable to verify your subscription plan. Please try again later.',
      });
    }

    const { role, plan } = subscription;
    const hasFeature = plan.features[feature];

    // ❌ If user doesn't have access → show relevant upgrade prompt
    if (!hasFeature) {
      // Use correct feature messages based on user role (NDIS vs Company)
      const featureMessages =
        role === 'Company' ? companyFeatureMessages : ndisFeatureMessages;

      const message =
        featureMessages[feature] ||
        `This feature is not available in your current plan. Please upgrade to access it.`;

      return res.status(403).json({
        status: false,
        message,
        current_plan: plan.type,
        current_plan_name: plan.name,
        role,
        upgrade_suggestion:
          role === 'Company' ? 'growth' : 'premium', // frontend can use this for upgrade modal
      });
    }

    // ✅ If feature is allowed → continue
    next();
  } catch (err) {
    console.error('❌ Error verifying feature access:', err.message);
    return res.status(500).json({
      status: false,
      message: 'Error verifying subscription access.',
      error: err.message,
    });
  }
};
