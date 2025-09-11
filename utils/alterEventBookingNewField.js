const pool = require('../dbconfig');

const alterEventBookingNewField = `
  ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS attendee_info JSONB DEFAULT '[]';
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterEventBookingNewField);
    console.log('✅ event_bookings table altered: attendee_info column added as JSONB.');
  } catch (err) {
    console.error('❌ Error altering event_bookings table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
