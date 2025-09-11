const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS location_accessibility (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    accessibility_requirements TEXT[],
    residential_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ location_accessibility table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating location_accessibility table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})(); 