const pool = require('../dbconfig');

const createTableQuery = `
CREATE TABLE IF NOT EXISTS cab_bookings (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    driver_id INT REFERENCES drivers(id),
    cab_type_id INT REFERENCES cab_types(id),
    disability_features_id INT REFERENCES disability_features(id),
    booking_type VARCHAR(20) NOT NULL CHECK (booking_type IN ('instant', 'later')),
    pickup_address TEXT NOT NULL,
    payment_intent_id VARCHAR(255),
    payment_status VARCHAR(50) DEFAULT 'pending',
    pickup_lat DECIMAL(10, 6) NOT NULL,
    pickup_lng DECIMAL(10, 6) NOT NULL,
    drop_address TEXT NOT NULL,
    drop_lat DECIMAL(10, 6) NOT NULL,
    drop_lng DECIMAL(10, 6) NOT NULL,
    scheduled_time TIMESTAMP,
    distance_km FLOAT,
    estimated_fare FLOAT,
    booking_mode VARCHAR(20) NOT NULL,
    booking_otp VARCHAR(20) DEFAULT NULL,
    booking_verified BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'accepted', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(createTableQuery);
    console.log('✅ cab_bookings table created or already exists.');
  } catch (err) {
    console.error('❌ Error creating cab_bookings table:', err.message);
  } finally {
    client.release();
    process.exit();
  }
})();
