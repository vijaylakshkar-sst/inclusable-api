const pool = require('../dbconfig');

const alterUsersTable = `
ALTER TABLE users
ADD COLUMN IF NOT EXISTS profile_image VARCHAR(255),
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS gender VARCHAR(10),
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_account_status VARCHAR(255),
ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(255);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterUsersTable);
    console.log('✅ users table altered: profile_image, date_of_birth, gender,stripe_customer_id, fcm_token columns added.');
  } catch (err) {
    console.error('❌ Error altering users table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})(); 