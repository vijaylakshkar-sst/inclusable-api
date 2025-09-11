const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS ndis_information (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ndis_number VARCHAR(50),
    preferred_event_types TEXT[],
    primary_disability_type TEXT[],
    support_requirements TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ ndis_information table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating ndis_information table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})(); 