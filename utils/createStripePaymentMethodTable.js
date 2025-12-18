const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE stripe_payment_methods (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  payment_method_id VARCHAR(255) NOT NULL,
  brand VARCHAR(50),
  last4 VARCHAR(4),
  created_at TIMESTAMP DEFAULT NOW()
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ Payment method table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating Payment method table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
