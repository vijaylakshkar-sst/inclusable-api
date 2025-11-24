const pool = require("../dbconfig");

const createTableQuery = `
CREATE TABLE IF NOT EXISTS stripe_keys (
    id SERIAL PRIMARY KEY,
    environment VARCHAR(20) NOT NULL UNIQUE CHECK (environment IN ('test', 'production')),
    publishable_key TEXT NOT NULL,
    secret_key TEXT NOT NULL,
    webhook_secret TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
`;

const seedQuery = `
INSERT INTO stripe_keys (environment, publishable_key, secret_key, webhook_secret)
VALUES
    ('test', 'hjk', 'hjk', 'whsec_DBlIqCdo4fghtGkozt5pOVMFGJ0nGjrNkJH'),
    ('production', 'hjkjh', 'hjk', 'whsec_live_xxxxx')
ON CONFLICT (environment) DO NOTHING;
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log("✅ stripe_keys table created or already exists.");

    await client.query(seedQuery);
    console.log("✅ stripe_keys table seeded.");
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
