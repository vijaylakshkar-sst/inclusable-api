const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS cab_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    category VARCHAR(50),
    description TEXT,
    fare_per_km FLOAT NOT NULL,
    seating_capacity INT DEFAULT 4,
    luggage_capacity VARCHAR(50),
    thumbnail_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ cab_types table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating cab_types table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
