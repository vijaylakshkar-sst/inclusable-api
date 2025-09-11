const pool = require('../dbconfig');

const createAccessibilityRequirementsTable = `
CREATE TABLE IF NOT EXISTS accessibility_requirements (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createAccessibilityRequirementsTable);
    console.log('✅ accessibility_requirements table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
