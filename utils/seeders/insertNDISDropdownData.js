const pool = require('../../dbconfig');

const insertDropdownData = async () => {
  const client = await pool.connect();
  try {
    // Clear existing data (optional)
    await client.query('DELETE FROM event_types');
    await client.query('DELETE FROM disability_types');
    await client.query('DELETE FROM support_requirements');

    // Insert into event_types
    const eventTypes = [
      'Festivals and Celebrations',
      'Concert or Performance',
      'Markets',
      'Exhibition and Shows',
      'Classes, Lessons, Workshops and Talks',
      'Community Event',
      'Food and Wine',
      'Sporting Events',
      'Business Event'
    ];
    for (const name of eventTypes) {
      await client.query('INSERT INTO event_types (name) VALUES ($1)', [name]);
    }

    // Insert into disability_types
    const disabilityTypes = [
      'Autism Spectrum Disorder (ASD)',
      'Deaf or Hard of Hearing',
      'Blind or Low Vision',
      'Intellectual Disability',
      'Developmental Delay'
    ];
    for (const name of disabilityTypes) {
      await client.query('INSERT INTO disability_types (name) VALUES ($1)', [name]);
    }

    // Insert into support_requirements
    const supportRequirements = [
      'Mobility Assistance',
      'Hearing/Vision Support',
      'Cognitive Support',
      'Transportation Support',
      'Sensory Support'
    ];
    for (const name of supportRequirements) {
      await client.query('INSERT INTO support_requirements (name) VALUES ($1)', [name]);
    }

    console.log('✅ Dropdown data inserted successfully.');
  } catch (err) {
    console.error('❌ Error inserting dropdown data:', err.message);
  } finally {
    client.release();
    process.exit();
  }
};

insertDropdownData();
