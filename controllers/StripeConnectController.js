const pool = require('../dbconfig');
const stripe = require('../stripe');

exports.createAccountLink = async (req, res) => {
  try {
    const user_id = req.user?.userId;

    if (!user_id)
      return res.status(401).json({ status: false, message: 'Unauthorized' });

    // Get user details
    const { rows } = await pool.query(
      'SELECT id, stripe_account_id, stripe_account_status FROM users WHERE id = $1',
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    const user = rows[0];

    // ✅ Case 1: User already has Stripe account but onboarding not completed
    if (user.stripe_account_id && user.stripe_account_status !== '3') {
      const accountLink = await stripe.accountLinks.create({
        account: user.stripe_account_id,
        refresh_url: `${process.env.API_BASE_URL}/stripe/web/onboarding_failed`,
        return_url: `${process.env.API_BASE_URL}/stripe/web/onboarding_success`,
        type: 'account_onboarding',
      });
console.log(accountLink);
console.log(`${process.env.API_BASE_URL}/stripe/web/onboarding_failed`);


      return res.status(200).json({
        status: true,
        message: 'Onboarding link generated successfully.',
        data: {
          account_url: accountLink.url,
          refresh_url: accountLink.refresh_url,
          return_url: accountLink.return_url,
        },
      })
    }

    // ✅ Case 2: User does not have a Stripe account → create one
    if (!user.stripe_account_id) {
      const account = await stripe.accounts.create({
        type: 'express',
      });

      await pool.query(
        'UPDATE users SET stripe_account_id = $1, stripe_account_status = $2 WHERE id = $3',
        [account.id, '1', user_id]
      );
console.log(process.env.API_BASE_URL);

      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${process.env.API_BASE_URL}/stripe/web/onboarding_failed`,
        return_url: `${process.env.API_BASE_URL}/stripe/web/onboarding_success`,
        type: 'account_onboarding',
      });

      return res.status(200).json({
        status: true,
        message: 'Onboarding link generated successfully.',
        data: {          
          account_url: accountLink.url,
          refresh_url: accountLink.refresh_url,
          return_url: accountLink.return_url,
        },
      })
    }

    // ✅ Case 3: Already completed onboarding
    return res.status(200).json({ status: true, message: 'Stripe account already created.' });
  } catch (error) {
    console.error("Stripe Onboarding Error:", error);
    return res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

exports.completeOnboarding = async (req, res) => {
  try {
    const user_id = req.user?.userId;

    if (!user_id)
      return res.status(401).json({ status: false, message: 'Unauthorized' });

    const { rows } = await pool.query(
      'SELECT id, stripe_account_id FROM users WHERE id = $1',
      [user_id]
    );

    if (rows.length === 0 || !rows[0].stripe_account_id) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    const user = rows[0];

    const account = await stripe.accounts.retrieve(user.stripe_account_id);

    if (account.charges_enabled) {
      let status = '3'; // Fully active
      let payoutMsg = '';

      if (!account.payouts_enabled) {
        status = '2'; // Under review
        payoutMsg = ' Your account is under review. Once approved, payouts will be settled automatically.';
      }

      await pool.query(
        'UPDATE users SET stripe_account_status = $1 WHERE id = $2',
        [status, user_id]
      );

      return res.status(200).json({
        status: true,
        message: 'Onboarding completed successfully.' + payoutMsg,
      })
    } else {
      return res.status(400).json({ status: false, message: 'Please enable charges on your Stripe account.' });
    }
  } catch (error) {
    console.error("Onboarding Complete Error:", error);
    return res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};
