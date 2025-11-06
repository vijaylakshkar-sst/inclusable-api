const pool = require('../dbconfig');

const createUserSubscriptionRenewalsTable = `
CREATE TABLE IF NOT EXISTS user_subscription_renewals (
    id SERIAL PRIMARY KEY,
    subscription_group_id INTEGER REFERENCES user_subscription_groups(id) ON DELETE CASCADE,
    renewal_number INT NOT NULL,                      -- 1 for first, 2 for next, etc.
    transaction_id VARCHAR(255) UNIQUE,               -- Apple/Google/Stripe ID
    payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
    start_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiry_date TIMESTAMP NOT NULL,
    renewal_status VARCHAR(30) DEFAULT 'success',     -- 'success', 'failed', 'refunded'
    auto_renew BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createUserSubscriptionRenewalsTable);
    console.log('✅ Renewal table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating payments table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
