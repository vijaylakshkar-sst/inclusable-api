const pool = require('../dbconfig');

const createSubscriptionPlansTable = `
-- Step 1: Create enum type if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audience_role_enum') THEN
    CREATE TYPE audience_role_enum AS ENUM ('Company', 'NDIS Member');
  END IF;
END$$;

-- Step 2: Create table using the enum type
CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,                        -- e.g. 'Monthly Plan'
    plan_type VARCHAR(50) NOT NULL,                    -- 'free', 'monthly', 'yearly'
    audience_role audience_role_enum NOT NULL,         -- 'Company' or 'NDIS Member'
    price NUMERIC(10, 2) DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'USD',
    description TEXT,
    features TEXT[],
    duration INTERVAL DEFAULT NULL,                    -- '1 month', '1 year'
    trial_days INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    icon VARCHAR(255) DEFAULT NULL,
    productId VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createSubscriptionPlansTable);
    console.log('✅ subscription_plans table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating subscription_plans table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
