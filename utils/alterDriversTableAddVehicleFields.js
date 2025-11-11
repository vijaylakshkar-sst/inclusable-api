const pool = require('../dbconfig');

const alterTableQuery = `
ALTER TABLE drivers
ADD COLUMN IF NOT EXISTS license_photo_front TEXT,
ADD COLUMN IF NOT EXISTS license_photo_back TEXT,
ADD COLUMN IF NOT EXISTS rc_copy TEXT,
ADD COLUMN IF NOT EXISTS insurance_copy TEXT,
ADD COLUMN IF NOT EXISTS police_check_certificate TEXT,
ADD COLUMN IF NOT EXISTS wwvp_card TEXT,
ADD COLUMN IF NOT EXISTS vehicle_make_id INT REFERENCES vehicle_makes(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS vehicle_model_id INT REFERENCES vehicle_models(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS manufacturing_year INT;
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterTableQuery);
    console.log('✅ drivers table updated with new vehicle fields.');
  } catch (err) {
    console.error('❌ Error updating drivers table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
