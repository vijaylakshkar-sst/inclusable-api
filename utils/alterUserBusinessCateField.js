const pool = require('../dbconfig');

const alterUserBusinessCateField = `
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS event_types TEXT[] DEFAULT NULL;
  ADD COLUMN IF NOT EXISTS accessibility TEXT[] DEFAULT NULL;
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterUserBusinessCateField);
    console.log('✅ Business Categories column added to users');
  } catch (err) {
    console.error('❌ Error adding Business Categories column:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
