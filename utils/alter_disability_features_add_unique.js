const pool = require('../dbconfig');

const alterTableQuery = `
ALTER TABLE disability_features
ADD CONSTRAINT unique_disability_name UNIQUE (name);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterTableQuery);
    console.log('✅ Added UNIQUE constraint on disability_features.name');
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('ℹ️ UNIQUE constraint already exists, skipping.');
    } else {
      console.error('❌ Error adding constraint:', err.message);
    }
  } finally {
    client.release();
    process.exit();
  }
})();
