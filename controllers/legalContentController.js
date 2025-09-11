const pool = require('../dbconfig');

// GET Privacy Policy
exports.getPrivacyPolicy = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM privacy_policies ORDER BY id DESC LIMIT 1');
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Privacy policy not found' });
    }
    res.json({ status: true, data: result.rows[0] });
  } catch (err) {
    console.error('Get Privacy Policy Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch privacy policy' });
  }
};

// GET Terms & Conditions
exports.getTermsConditions = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM terms_conditions ORDER BY id DESC LIMIT 1');
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Terms & Conditions not found' });
    }
    res.json({ status: true, data: result.rows[0] });
  } catch (err) {
    console.error('Get Terms Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch terms & conditions' });
  }
};
