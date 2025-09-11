const pool = require('../dbconfig');

const createTermsConditionsTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS terms_conditions (
      id SERIAL PRIMARY KEY,
      title TEXT,
      content TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(query);
    console.log('✅ terms_conditions table created successfully');
  } catch (err) {
    console.error('❌ Error creating terms_conditions table:', err.message);
  }
};

createTermsConditionsTable();
