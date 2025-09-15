// controllers/locationAccessibilityController.js
const pool = require('../dbconfig');

exports.getDropdownValues = async (req, res) => {
  try {
    const accessibilityRes = await pool.query('SELECT name FROM accessibility_requirements');
    res.json({status: true,
      accessibility_requirements: accessibilityRes.rows.map(row => row.name)
    });
  } catch (err) {
    console.error('❌ Error fetching accessibility requirements:', err.message);
    res.status(500).json({ status: false, error: 'Failed to load dropdown values' });
  }
};

exports.submitLocationAccessibility = async (req, res) => {
  const userId = req.user.userId;
  const { accessibility_requirements, residential_address, skipped } = req.body;
  if (skipped === 'true' || skipped === true) {
    try {
      await pool.query(
        `INSERT INTO user_onboarding_skips (user_id, step_name) VALUES ($1, $2)
         ON CONFLICT (user_id, step_name) DO NOTHING`,
        [userId, 'location_accessibility']
      );
      return res.json({ status: true, message: 'User skipped location & accessibility.' });
    } catch (err) {
      console.error('Skip location & accessibility error:', err.message);
      return res.status(500).json({status: false, error: 'Internal server error.' });
    }
  }
  if (!accessibility_requirements || !residential_address) {
    return res.status(400).json({status: false, error: 'All fields are required.' });
  }
  try {
    // Upsert logic: if exists, update; else, insert
    const existing = await pool.query('SELECT id FROM location_accessibility WHERE user_id = $1', [userId]);
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE location_accessibility SET accessibility_requirements = $1, residential_address = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3`,
        [accessibility_requirements, residential_address, userId]
      );
    } else {
      await pool.query(
        `INSERT INTO location_accessibility (user_id, accessibility_requirements, residential_address) VALUES ($1, $2, $3)` ,
        [userId, accessibility_requirements, residential_address]
      );
    }
    // Fetch updated user details
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    res.json({
      status: true,
      message: 'Location & accessibility needs saved successfully.',
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone_number: user.phone_number,
        role: user.role,
        is_verified: user.is_verified,
        profile_image_url: user.profile_image ? `https://stgn.appsndevs.com/inclusable/uploads/${user.profile_image}` : null,
        profile_image: user.profile_image,
        date_of_birth: user.date_of_birth,
        gender: user.gender,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (err) {
    console.error('Location & accessibility save error:', err.message);
    res.status(500).json({ status: false, error: 'Internal server error.' });
  }
}; 