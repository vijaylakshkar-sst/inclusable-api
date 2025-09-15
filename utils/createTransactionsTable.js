// utils/createTransactionsTable.js
const pool = require('../dbconfig');

const createTransactionsTable = `
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES event_bookings(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  event_id INTEGER REFERENCES company_events(id),
  payment_intent_id VARCHAR(255) UNIQUE,
  amount NUMERIC(10,2),
  currency VARCHAR(10) DEFAULT 'aud',
  status VARCHAR(50), -- pending, succeeded, failed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTransactionsTable);
    console.log('✅ transactions table created');
  } catch (err) {
    console.error('❌ Error creating transactions table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
