const pool = require('../dbconfig');

const createNotificationsTable = `
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  driver_id INT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  booking_id INT, -- can refer to cab_bookings or event_bookings
  company_event_id INT REFERENCES company_events(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'system', -- e.g., booking, status, cancellation
  target VARCHAR(20) NOT NULL CHECK (target IN ('NDIS Member', 'Driver','Company')),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createNotificationsTable);
    console.log('✅ notifications table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating notifications table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
