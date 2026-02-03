const pool = require('../dbconfig');

const createCompanyEventBookingItemTable = `CREATE TABLE IF NOT EXISTS event_booking_items (
  id SERIAL PRIMARY KEY,

  booking_id INTEGER REFERENCES event_bookings(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES company_events(id) ON DELETE CASCADE,
  ticket_id INTEGER REFERENCES company_event_tickets(id) ON DELETE CASCADE,

  ticket_type VARCHAR(100),
  is_companion BOOLEAN DEFAULT FALSE,

  quantity INTEGER NOT NULL,
  price_per_ticket NUMERIC(10,2) NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createCompanyEventBookingItemTable);
    console.log('✅ event_booking_items table created');
  } catch (err) {
    console.error('❌ Error creating event_booking_items table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();