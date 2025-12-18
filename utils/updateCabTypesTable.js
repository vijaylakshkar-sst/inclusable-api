const pool = require('../dbconfig');

const alterTableQuery = `
ALTER TABLE cab_types
    DROP COLUMN IF EXISTS category,
    DROP COLUMN IF EXISTS description,
    DROP COLUMN IF EXISTS standard_price,
    DROP COLUMN IF EXISTS seating_capacity,
    DROP COLUMN IF EXISTS luggage_capacity,
    ADD COLUMN IF NOT EXISTS standard_price FLOAT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS disability_feature_price FLOAT NOT NULL DEFAULT 0;
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterTableQuery);
    console.log('✅ cab_types table updated successfully.');
  } catch (err) {
    console.error('❌ Error updating cab_types table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
