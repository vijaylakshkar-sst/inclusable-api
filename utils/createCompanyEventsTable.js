const pool = require('../dbconfig');

const createCompanyEventsTable = `
CREATE TABLE IF NOT EXISTS company_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  
  event_name TEXT NOT NULL,
  event_types TEXT[] DEFAULT NULL,
  disability_types TEXT[] DEFAULT NULL,
  accessibility_types TEXT[] DEFAULT NULL,
  
  event_description TEXT,
  event_thumbnail TEXT,
  event_images TEXT[] DEFAULT '{}',
  
  start_date DATE,
  end_date DATE,
  start_time TIME,
  end_time TIME,
  
  price_type TEXT,
  price NUMERIC(10, 2),
  total_available_seats INTEGER,
  
  event_address TEXT,
  how_to_reach_destination TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createCompanyEventsTable);
    console.log('✅ company_events table created successfully.');
  } catch (err) {
    console.error('❌ Error creating company_events table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
