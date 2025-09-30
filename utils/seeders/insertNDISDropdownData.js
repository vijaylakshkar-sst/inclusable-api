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
      'Developmental Delay',
      'Physical',
      'Sensory',
      'Intellectual',
      'Psychosocial',
      'Neurological',
      'Hearing Loss / Deaf',
      'Learning Disability',
      'Speech & Language Disorders',
      'Cerebral Palsy',
      'Down Syndrome',
      'Spinal Cord Injury',
      'Muscular Dystrophy',
      'Multiple Sclerosis (MS)',
      'Acquired Brain Injury (ABI)',
      'Stroke-related Disability',
      'Epilepsy',
      'Parkinson’s Disease',
      'Chronic Pain Condition',
      'Chronic Fatigue Syndrome',
      'Amputation / Limb Difference',
      'Psychosocial Disability',
      'Schizophrenia',
      'Bipolar Disorder',
      'Severe Anxiety or Depression',
      'PTSD (Post-Traumatic Stress Disorder)',
      'ADHD',
      'Global Developmental Delay',
      'Rare Genetic Disorders',
      'Sensory Processing Disorder',
      'Deafblindness'
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
      'Sensory Support',
      'Wheelchair-accessible',
      'Accessible bathrooms',
      'Screen reader',
      'Clear signage',
      'Sensory-friendly environments',
      'Visual indicators for important alerts',
      'Ramps in shared spaces',
      'Support for booking accessible taxis',
      'Help with completing forms in an accessible format.',
      "Step-free entry / ramp access", 
      "Wide doorways and hallways", 
      "Automatic or easy-to-open doors", 
      "Wheelchair-accessible toilets", 
      "Accessible counters and service desks", 
      "Adjustable height service desks", 
      "Grab rails and support bars", 
      "Lowered sinks, taps, and hand dryers", 
      "Accessible car parking spots", 
      "Drop-off zones near entrances", 
      "Ramps in shared spaces", 
      "Smooth, non-slip flooring", 
      "Clear, wide pathways without obstructions", 
      "Accessible elevators with wheelchair access", 
      "Braille and tactile signage", 
      "Braille and tactile lift buttons", 
      "Tactile Ground Surface Indicators (TGSI)", 
      "High-contrast, large-font signage", 
      "Visual indicators for important alerts", 
      "Visual fire alarms", 
      "Glare-free and well-lit environments",
       "Wayfinding systems for vision-impaired users", 
       "Hearing loops or audio assistance systems",
       "Audio announcements in lifts and public areas", "Audio fire alarms", "Wayfinding systems for hearing-impaired users", "Sensory-friendly environments", "Clear, consistent signage and navigation", "Quiet areas or reduced stimulation spaces", "Staff trained in cognitive support", "Accessible taxis or support for booking", "Proximity to accessible public transport (buses, trains)", "Reserved priority seating and space for mobility devices", "Accessible seating with armrests", "Wheelchair companion seating spaces", "Priority seating clearly marked", "Adult change facilities", "Emergency lighting and backup power", "Assistance counters for accessible support", "Service animals welcome", "Accessible evacuation routes and exits", "Staff trained in accessibility emergency protocols"
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
