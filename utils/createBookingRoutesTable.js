const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS booking_routes (
    id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL REFERENCES cab_bookings(id) ON DELETE CASCADE,
    route_polyline TEXT,
    distance_text VARCHAR(50),
    duration_text VARCHAR(50),
    raw_json JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ booking_routes table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating booking_routes table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
