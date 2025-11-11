const pool = require('../dbconfig');

const createDriverDisabilityFeaturesTable = `
CREATE TABLE IF NOT EXISTS driver_disability_features (
  id SERIAL PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  disability_feature_id INT NOT NULL REFERENCES disability_features(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createDriverDisabilityFeaturesTable);
    console.log('✅ driver_disability_features table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating driver_disability_features table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();