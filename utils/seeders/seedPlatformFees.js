const pool = require('../../dbconfig');

const seedPlatformFees = async () => {
  const client = await pool.connect();
  try {
    console.log("🌱 Seeding platform_fees table...");

    // Check if already seeded
    const checkQuery = `SELECT COUNT(*) AS count FROM platform_fees`;
    const { rows } = await client.query(checkQuery);

    if (parseInt(rows[0].count) > 0) {
      console.log("ℹ️ platform_fees table already has data. Skipping seeding.");
      return;
    }

    // Insert default data
    const insertQuery = `
      INSERT INTO platform_fees 
        (service_type, company_fee, driver_fee, member_fee, platform_fee, fee_type)
      VALUES
        ('Cab Booking', 10.00, 5.00, 0.00, 2.00, 'flat'),
        ('Event Booking', 8.00, 4.00, 2.00, 100.00, 'flat'),
        ('Other Services', 5.00, 2.00, 1.00, 1.00, 'flat');
    `;

    await client.query(insertQuery);
    console.log("✅ platform_fees seeded successfully!");
  } catch (err) {
    console.error("❌ Error seeding platform_fees:", err.message);
  } finally {
    client.release();
    process.exit();
  }
};

seedPlatformFees();
