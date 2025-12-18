const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS driver_reviews (
  id SERIAL PRIMARY KEY,

  user_id INT NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  driver_id INT NOT NULL
    REFERENCES drivers(id) ON DELETE CASCADE,

  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  description TEXT,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ driver_reviews table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating driver_reviews table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
