const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS user_onboarding_skips (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    step_name VARCHAR(50) NOT NULL,
    PRIMARY KEY (user_id, step_name)
);`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ user_onboarding_skips table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating user_onboarding_skips table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})(); 