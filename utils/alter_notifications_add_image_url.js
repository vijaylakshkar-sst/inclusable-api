const pool = require('../dbconfig');

const alterNotificationsTable = `
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS image_url TEXT NULL,
ADD COLUMN IF NOT EXISTS bg_color TEXT NULL;
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterNotificationsTable);
    console.log('✅ Added "image_url"fdf column to notifications table.');
  } catch (err) {
    console.error('❌ Error adding image_url column:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
