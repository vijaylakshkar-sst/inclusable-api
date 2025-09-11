const pool = require('../../dbconfig');

const insertTermsConditions = async () => {
  const query = `
    INSERT INTO terms_conditions (title, content)
    VALUES 
      ('General Terms', 'By using this service, you agree to our terms.')
  `;

  try {
    await pool.query(query);
    console.log('✅ Dummy terms & conditions inserted successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error inserting terms & conditions:', err.message);
    process.exit(1);
  }
};

insertTermsConditions();
