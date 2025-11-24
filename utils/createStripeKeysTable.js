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
    ('test', 'pk_test_51SIgofRy2tSjrfvAlRFYM801gPuen8zEvsIPam9YuH8AnOzDgMg8SiHOyelFVOJekCvnZBr4BYhUGoCgP8FgcuRd00HVdew2RE', 'sk_test_51SIgofRy2tSjrfvAymU2pILf6q13pMKJF0rDHVpzyiRCLNbgcDQa4RnutPOrDQpJkL4Bj72S8NRgBQEONbqpXLJd00X6mO6nj4', 'whsec_DBlIqCdo4tGkozt5pOVMFGJ0nGjrNkJH'),
    ('production', 'pk_live_51SIgoNRrFdjZS8bFjix2a7RmiRJb6AVkUTGBUPQl8iLyhaEHLfBI1qJT6u8hh8RfR3VnbH7OPEjt2W4r3F6prNUJ00a8lUSn6D', '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', 'whsec_live_xxxxx')
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
