const pool = require('../dbconfig');

const createUserSubscriptionsTable = `
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    platform VARCHAR(50),                                  -- 'ios', 'android', 'web'
    subscription_status VARCHAR(30) DEFAULT 'active',      -- 'active', 'expired', 'cancelled'
    start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_date TIMESTAMP,                                 -- calculated from duration
    next_renewal_date TIMESTAMP,                           -- for auto-renew
    auto_renew BOOLEAN DEFAULT FALSE,
    last_payment_id INTEGER REFERENCES payments(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createUserSubscriptionsTable);
    console.log('✅ user_subscriptions table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating user_subscriptions table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
