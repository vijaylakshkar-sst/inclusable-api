const pool = require('../dbconfig');

const createUserSubscriptionGroupsTable = `
CREATE TABLE IF NOT EXISTS user_subscription_groups (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
    platform VARCHAR(50),                               -- 'ios', 'android', 'web'
    provider VARCHAR(50),                               -- 'apple', 'google', 'stripe'
    group_status VARCHAR(30) DEFAULT 'active',          -- 'active', 'cancelled', 'expired'
    auto_renew BOOLEAN DEFAULT TRUE,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cancelled_at TIMESTAMP NULL,
    ended_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;


(async () => {
  const client = await pool.connect();
  try {
    await client.query(createUserSubscriptionGroupsTable);
    console.log('✅ User Subscription Groups table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating User Subscription Groups table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();