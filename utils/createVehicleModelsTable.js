const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS vehicle_models (
  id SERIAL PRIMARY KEY,
  make_id INT NOT NULL REFERENCES vehicle_makes(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ vehicle_models table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating vehicle_models table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
