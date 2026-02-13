const pool = require('../dbconfig');

const createBookingAttendeesTable = `
    CREATE TABLE IF NOT EXISTS event_booking_attendees (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER REFERENCES event_bookings(id) ON DELETE CASCADE,
    attendee_name VARCHAR(255) NOT NULL,
    attendee_email VARCHAR(255),
    checkin_status VARCHAR(20) DEFAULT 'pending', -- pending | checked_in
    checkin_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createBookingAttendeesTable);
    console.log('✅ event_booking_attendees table created');
  } catch (err) {
    console.error('❌ Error creating event_booking_attendees table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
