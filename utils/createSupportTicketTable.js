const pool = require('../dbconfig');

const createSupportTicketTable = async () => {
  const query = `
   CREATE TABLE support_tickets (
        id SERIAL PRIMARY KEY,            -- auto-increment ID
        user_id INT NULL,                 -- optional reference to user who submitted
        subject VARCHAR(255) NOT NULL,    -- subject of the ticket
        message TEXT NOT NULL,            -- detailed message
        status VARCHAR(50) DEFAULT 'open',-- ticket status: open, pending, closed
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        deleted_at TIMESTAMP NULL         -- for soft delete
    );`;

  try {
    await pool.query(query);
    console.log('✅ Help and Support table created successfully');
  } catch (err) {
    console.error('❌ Error creating Help and Support table:', err.message);
  }
};

createSupportTicketTable();

