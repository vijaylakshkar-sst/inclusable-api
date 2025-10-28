const pool = require('../dbconfig');

const createPlatformFeesTable = `
CREATE TABLE IF NOT EXISTS platform_fees (
  id SERIAL PRIMARY KEY,
  service_type VARCHAR(100) NOT NULL,       -- e.g., "Cab Booking", "Event Booking"
  company_fee NUMERIC(10,2) DEFAULT 0.00,   -- percentage or fixed fee for company
  driver_fee NUMERIC(10,2) DEFAULT 0.00,    -- percentage or fixed fee for driver
  member_fee NUMERIC(10,2) DEFAULT 0.00,    -- percentage or fixed fee for NDIS member
  platform_fee NUMERIC(10,2) DEFAULT 0.00,    -- percentage or fixed fee for platform Fee
  fee_type VARCHAR(20) DEFAULT 'percentage' CHECK (fee_type IN ('percentage', 'flat')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createPlatformFeesTable);
    console.log("✅ platform_fees table created or already exists.");
  } catch (err) {
    console.error("❌ Error creating platform_fees table:", err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
