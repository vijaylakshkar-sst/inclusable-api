const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS disability_features (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ disability_features table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating disability_features table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
