const pool = require('../../dbconfig');

const disabilityFeatures = [
  'Wheelchair ramp/lift',
  'Wheelchair docking system',
  'Swivel seats',
  'Grab handles/support bars',
  'Visual & audio assistance devices',
  'Spacious interior for wheelchair movement'
];

(async () => {
  const client = await pool.connect();

  try {
    console.log('🌱 Seeding disability features...');

    for (const name of disabilityFeatures) {
      await client.query(
        `INSERT INTO disability_features (name)
         VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }

    console.log('✅ Disability features seeded successfully.');
  } catch (err) {
    console.error('❌ Error seeding disability features:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
