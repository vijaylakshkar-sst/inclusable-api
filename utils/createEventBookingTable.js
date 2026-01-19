const pool = require('../dbconfig');

const createEventBookingTable = `
CREATE TABLE IF NOT EXISTS event_bookings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES company_events(id) ON DELETE CASCADE,
  event_price NUMERIC(10,2),
  number_of_tickets INTEGER,
  total_amount NUMERIC(10,2),
  event_booking_date DATE DEFAULT CURRENT_DATE, 
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createEventBookingTable);
    console.log('✅ event_bookings table created');
  } catch (err) {
    console.error('❌ Error creating event_bookings table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
