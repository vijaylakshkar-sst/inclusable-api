const pool = require('../dbconfig');

const createEventsTable = `
-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    start_date DATE,
    end_date DATE,
    suburb TEXT,
    postcode TEXT,
    state TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    category TEXT[],
    website TEXT,
    image_url TEXT,
    host TEXT,
    embedding VECTOR(1536)
);`;

(async () => {
  const client = await pool.connect();
  try {
    // Create events table
    await client.query(createEventsTable);
    console.log('✅ events table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating tables:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
