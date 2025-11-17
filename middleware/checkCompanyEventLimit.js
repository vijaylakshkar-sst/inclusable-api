const pool = require('../dbconfig');
const { getCurrentAccess } = require('../hooks/checkPermissionHook');

exports.checkCompanyEventLimit = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const subscription = await getCurrentAccess(req, res, true);

    // 🧩 Verify company role
    if (subscription.role !== 'Company') {
      return res.status(403).json({
        status: false,
        message: 'Only company accounts can post events.'
      });
    }

    const { plan } = subscription;
    const { features } = plan;
    const maxAllowed = features.maxEventPosts;

    // 🆓 Unlimited plan (Professional) → skip check
    if (maxAllowed === 'Unlimited') {
      return next();
    }

    // 📅 Count this month's events
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const query = `
      SELECT COUNT(*) AS total_events
      FROM company_events
      WHERE user_id = $1
        AND created_at >= $2
    `;
    const { rows } = await pool.query(query, [userId, startOfMonth]);
    const postedCount = parseInt(rows[0].total_events, 10);

    // 🚫 Exceeded monthly limit
    if (postedCount >= maxAllowed) {
      return res.status(403).json({
        status: false,
        message: `You’ve reached your monthly limit of ${maxAllowed} event${maxAllowed > 1 ? 's' : ''}.`,
        current_plan: plan.name,
        upgrade_suggestion:
          plan.type === 'starter' ? 'growth' : 'professional'
      });
    }

    next();
  } catch (err) {
    console.error('❌ Error checking company event limit:', err.message);
    res.status(500).json({
      status: false,
      message: 'Error verifying event posting limit.',
      error: err.message
    });
  }
};
