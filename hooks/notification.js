// utils/notification.js
const pool = require('../dbconfig');

exports.sendNotification = async ({
  user_id = null,
  driver_id = null,
  booking_id = null,
  title,
  message,
  type = 'system',
  target = 'user' // or 'driver'
}) => {
  if (!title || !message || !target) {
    console.error('❌ Notification Error: Missing required fields (title, message, target)');
    return;
  }

  const client = await pool.connect();

  try {
    await client.query(
      `
      INSERT INTO notifications (
        user_id, driver_id, booking_id, title, message, type, target
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [user_id, driver_id, booking_id, title, message, type, target]
    );
  } catch (err) {
    console.error('❌ Notification Error:', err.message);
  } finally {
    client.release();
  }
};
