const pool = require('../dbconfig');

const createNDISDropdownTables = `
CREATE TABLE IF NOT EXISTS event_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disability_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_requirements (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createNDISDropdownTables);
    console.log('✅ Dropdown tables created or already exist.');
  } catch (err) {
    console.error('❌ Error creating dropdown tables:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
