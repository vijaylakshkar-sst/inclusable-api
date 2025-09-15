const pool = require('../dbconfig');

const alterEventBookings_addStatus = `
  ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterEventBookings_addStatus);
    console.log('✅ status column added to event_bookings');
  } catch (err) {
    console.error('❌ Error adding status column:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
