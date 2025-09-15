// controllers/ndisController.js
const pool = require('../dbconfig');

// Validation function for NDIS number
const validateNdisNumber = (ndisNumber) => {
  // Check for exactly 9 digits
  const ndisRegex = /^\d{9}$/;
  if (!ndisRegex.test(ndisNumber)) {
    return { isValid: false, error: 'NDIS Number must be 9 digits.' };
  }
  
  return { isValid: true };
};

exports.getDropdownValues = async (req, res) => {
  try {
    const [eventTypes, disabilityTypes, supportRequirements] = await Promise.all([
      pool.query('SELECT name FROM event_types'),
      pool.query('SELECT name FROM disability_types'),
      pool.query('SELECT name FROM support_requirements'),
    ]);

    res.json({
      status: true,
      event_types: eventTypes.rows.map(row => row.name),
      disability_types: disabilityTypes.rows.map(row => row.name),
      support_requirements: supportRequirements.rows.map(row => row.name)
    });
  } catch (error) {
    console.error('Error fetching dropdown values:', error);
    res.status(500).json({ status: false, error: 'Failed to load dropdown values' });
  }
};

exports.submitNdisInfo = async (req, res) => {
  const userId = req.user.userId;
  const { ndis_number, preferred_event_types, primary_disability_type, support_requirements, skipped } = req.body;
  if (skipped === 'true' || skipped === true) {
    try {
      await pool.query(
        `INSERT INTO user_onboarding_skips (user_id, step_name) VALUES ($1, $2)
         ON CONFLICT (user_id, step_name) DO NOTHING`,
        [userId, 'ndis_information']
      );
      return res.json({ status: true, message: 'User skipped NDIS information.' });
    } catch (err) {
      console.error('Skip NDIS info error:', err.message);
      return res.status(500).json({ status: false, error: 'Internal server error.' });
    }
  }
  
  // Comment out old validation logic
  // if (!ndis_number || !preferred_event_types || !primary_disability_type || !support_requirements) {
  //   return res.status(400).json({ error: 'All fields are required.' });
  // }
  
  // New comprehensive validation
  if (!ndis_number || !preferred_event_types || !primary_disability_type || !support_requirements) {
    return res.status(400).json({ status: false, error: 'All fields are required.' });
  }
  
  // Validate NDIS number
  const ndisValidation = validateNdisNumber(ndis_number);
  if (!ndisValidation.isValid) {
    return res.status(400).json({ status: false, error: ndisValidation.error });
  }
  
  try {
    // Upsert logic: if exists, update; else, insert
    const existing = await pool.query('SELECT id FROM ndis_information WHERE user_id = $1', [userId]);
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE ndis_information SET ndis_number = $1, preferred_event_types = $2, primary_disability_type = $3, support_requirements = $4, updated_at = CURRENT_TIMESTAMP WHERE user_id = $5`,
        [ndis_number, preferred_event_types, primary_disability_type, support_requirements, userId]
      );
    } else {
      await pool.query(
        `INSERT INTO ndis_information (user_id, ndis_number, preferred_event_types, primary_disability_type, support_requirements) VALUES ($1, $2, $3, $4, $5)` ,
        [userId, ndis_number, preferred_event_types, primary_disability_type, support_requirements]
      );
    }
    // Fetch updated user details
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    res.json({
      status: true,
      message: 'NDIS information saved successfully.',
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
    console.error('NDIS info save error:', err.message);
    res.status(500).json({ status: false, error: 'Internal server error.' });
  }
}; 