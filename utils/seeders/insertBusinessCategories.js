const pool = require('../../dbconfig');

const insertBusinessCategories = async () => {
  const client = await pool.connect();
  try {
    // Optional: Clear existing data
    await client.query('DELETE FROM business_categories');

    const values = [
        "Music",
        "Business & professional",
        "Food & drink",
        "Community & culture",
        "Performing & visual arts",
        "Film, media & entertainment",
        "Sports & fitness",
        "Health & wellness",
        "Science & technology",
        "Travel & outdoor",
        "Charity & causes",
        "Religion & spirituality",
        "Family & education",
        "Seasonal & holiday",
        "Government & politics",
        "Fashion & beauty",
        "Home & lifestyle",
    ];

    for (const name of values) {
      await client.query('INSERT INTO business_categories (name) VALUES ($1)', [name]);
    }

    console.log('✅ business_categories data inserted.');
  } catch (err) {
    console.error('❌ Error inserting data:', err.message);
  } finally {
    client.release();
    process.exit();
  }
};

insertBusinessCategories();
