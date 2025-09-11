const pool = require('../../dbconfig');

const insertPrivacyPolicies = async () => {
  const query = `
    INSERT INTO privacy_policies (title, content)
    VALUES 
      ('Privacy Policy for Users', 'This is our user privacy policy. We protect your data.')
  `;

  try {
    await pool.query(query);
    console.log('✅ Dummy privacy policies inserted successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error inserting privacy policies:', err.message);
    process.exit(1);
  }
};

insertPrivacyPolicies();
