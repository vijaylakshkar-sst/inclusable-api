const pool = require('../dbconfig');

const createPrivacyPolicyTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS privacy_policies (
      id SERIAL PRIMARY KEY,
      title TEXT,
      content TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(query);
    console.log('✅ privacy_policies table created successfully');
  } catch (err) {
    console.error('❌ Error creating privacy_policies table:', err.message);
  }
};

createPrivacyPolicyTable();
