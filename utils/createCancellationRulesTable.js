const pool = require("../dbconfig");

const createTableQuery = `
CREATE TABLE IF NOT EXISTS cancellation_rules (
  id SERIAL PRIMARY KEY,
  deduction_percentage DECIMAL(5,2) NOT NULL, 
  minimum_deduction_amount DECIMAL(10,2) NOT NULL, 
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

const seedQuery = `
INSERT INTO cancellation_rules (deduction_percentage, minimum_deduction_amount)
SELECT 5.00, 10.00       -- default values
WHERE NOT EXISTS (SELECT 1 FROM cancellation_rules);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log("🟢 cancellation_rules table ensured");

    await client.query(seedQuery);
    console.log("🟢 default rule seeded if none existed");

  } catch (err) {
    console.error("❌ error:", err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
