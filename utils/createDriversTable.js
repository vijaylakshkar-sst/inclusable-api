const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS drivers (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cab_type_id INT REFERENCES cab_types(id),
    vehicle_number VARCHAR(20) NOT NULL,
    license_number VARCHAR(50),
    current_lat DECIMAL(10, 6),
    current_lng DECIMAL(10, 6),
    is_available BOOLEAN DEFAULT TRUE,
    status VARCHAR(20) DEFAULT 'offline',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ drivers table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating drivers table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
