const pool = require('../../dbconfig');

const insertAccessibilityRequirements = async () => {
  const client = await pool.connect();
  try {
    // Optional: Clear existing data
    await client.query('DELETE FROM accessibility_requirements');

    const values = [
      'Text Messaging / Typing',
      'Email / Digital Communication',
      'Visual Schedules or Symbols',
      'Eye-Gaze Technology',
      'Verbal / Spoken Language',
      'Sign Language',
      'Written Communication',
      'Gestures / Body Language'
    ];

    for (const name of values) {
      await client.query('INSERT INTO accessibility_requirements (name) VALUES ($1)', [name]);
    }

    console.log('✅ accessibility_requirements data inserted.');
  } catch (err) {
    console.error('❌ Error inserting data:', err.message);
  } finally {
    client.release();
    process.exit();
  }
};

insertAccessibilityRequirements();
