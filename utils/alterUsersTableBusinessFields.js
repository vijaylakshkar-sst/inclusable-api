const pool = require('../dbconfig');

const alterUsersTable = `
ALTER TABLE users
ADD COLUMN IF NOT EXISTS business_name TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS business_category TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS business_email TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS business_phone_number TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS business_logo TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS abn_number TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ndis_registration_number TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS website_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS year_experience INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS address TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS business_overview TEXT DEFAULT NULL;
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(alterUsersTable);
    console.log('✅ users table altered: business-related columns added (default NULL).');
  } catch (err) {
    console.error('❌ Error altering users table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
