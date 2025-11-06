const pool = require('../dbconfig');

const createPaymentsTable = `
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES subscription_plans(id),
    platform VARCHAR(50),
    provider VARCHAR(50),
    transaction_id VARCHAR(255) UNIQUE,
    amount NUMERIC(10,2),
    currency VARCHAR(10) DEFAULT 'USD',
    payment_status VARCHAR(50) DEFAULT 'pending',      -- 'pending', 'success', 'failed', 'refunded'
    receipt_data TEXT,
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createPaymentsTable);
    console.log('✅ payments table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating payments table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
