const pool = require('../dbconfig');

const createBusinessCategoryTable = `
CREATE TABLE IF NOT EXISTS business_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createBusinessCategoryTable);
    console.log('✅ business_categories table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
