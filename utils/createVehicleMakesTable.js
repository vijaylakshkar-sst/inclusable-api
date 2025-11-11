const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS vehicle_makes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ vehicle_makes table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating vehicle_makes table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
