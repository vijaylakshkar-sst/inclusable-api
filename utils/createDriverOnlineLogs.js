const pool = require('../dbconfig');

const createTableQuery = `CREATE TABLE IF NOT EXISTS driver_status_logs (
    id SERIAL PRIMARY KEY,
    driver_id INT REFERENCES drivers(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('online', 'offline')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;


(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ driver online logs table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating driver online logs table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();