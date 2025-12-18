const pool = require('../dbconfig');

const alterTableQuery = `
ALTER TABLE vehicle_models
ADD COLUMN IF NOT EXISTS cab_type_id INT
REFERENCES cab_types(id)
ON DELETE SET NULL;
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterTableQuery);
    console.log('✅ cab_type_id added to vehicle_models table.');
  } catch (err) {
    console.error('❌ Error updating vehicle_models table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
