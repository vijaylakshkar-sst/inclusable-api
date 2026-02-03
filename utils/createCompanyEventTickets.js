const pool = require('../dbconfig');

const createCompanyEventTicketsTable = `CREATE TABLE IF NOT EXISTS company_event_tickets (
  id SERIAL PRIMARY KEY,

  company_event_id INTEGER NOT NULL
    REFERENCES company_events(id)
    ON DELETE CASCADE,

    ticket_type TEXT NOT NULL,
    price_type TEXT NOT NULL, 
    ticket_price NUMERIC(10,2),
    total_seats INTEGER,
    ticket_note TEXT,

    allow_companion BOOLEAN DEFAULT FALSE,
    companion_ticket_type TEXT DEFAULT NULL,
    companion_price_type TEXT DEFAULT NULL,
    companion_ticket_price NUMERIC(10,2) DEFAULT 0.00,
    companion_total_seats INTEGER DEFAULT NULL,
    companion_ticket_note TEXT DEFAULT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createCompanyEventTicketsTable);
    console.log('✅ event_tickets table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating event_tickets table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();