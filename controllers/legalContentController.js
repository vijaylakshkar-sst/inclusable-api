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

exports.createSupportTicket = async (req, res) => {
  const user_id = req.user?.userId; // optional if user is logged in
  const { subject, message } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ status: false, message: 'Subject and message are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO support_tickets (user_id, subject, message)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user_id || null, subject, message]
    );

    res.status(201).json({
      status: true,
      message: 'Support ticket submitted successfully',
      data: result.rows[0],
    });
  } catch (err) {
    console.error('Error creating support ticket:', err);
    res.status(500).json({ status: false, message: 'Server error', error: err.message });
  }
};