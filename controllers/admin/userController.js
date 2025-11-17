// controllers/userController.js
const pool = require('../../dbconfig');
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;

exports.getNdisMembers = async (req, res) => {
  try {
    const query = `
      SELECT id, full_name, email, phone_number, profile_image,gender,date_of_birth created_at
      FROM users
      WHERE role = 'NDIS Member' AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query);
    res.json({ status: true, data: rows });
  } catch (error) {
    console.error('❌ Error fetching NDIS Members:', error.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.getBusinessMembers = async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM users
      WHERE role = 'Company' AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query);
    res.json({ status: true, data: rows });
  } catch (error) {
    console.error('❌ Error fetching Companies:', error.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.deleteUser = async (req, res) => {
    const { id } = req.params;

    try {
        // Check if user exists and not already deleted
        const checkQuery = 'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL';
        const { rows } = await pool.query(checkQuery, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: 'User not found' });
        }

        // Soft delete user by setting deleted_at
        const deleteQuery = 'UPDATE users SET deleted_at = NOW() WHERE id = $1';
        await pool.query(deleteQuery, [id]);

        return res.json({ status: true, message: 'User deleted successfully' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: 'Server error' });
    }
};

exports.getEventsByBusiness = async (req, res) => {
  const { id } = req.params; // company id

  try {
    const query = `
      SELECT 
        u.id AS company_id,
        u.full_name AS company_name,
        json_agg(
          json_build_object(
            'event_id', e.id,
            'event_name', e.event_name,
            'event_types', e.event_types,
            'disability_types', e.disability_types,
            'accessibility_types', e.accessibility_types,
            'event_description', e.event_description,
            'event_thumbnail', e.event_thumbnail,
            'event_images', e.event_images,
            'start_date', e.start_date,
            'end_date', e.end_date,
            'start_time', e.start_time,
            'end_time', e.end_time,
            'price_type', e.price_type,
            'price', e.price,
            'total_available_seats', e.total_available_seats,
            'event_address', e.event_address,
            'how_to_reach_destination', e.how_to_reach_destination,
            'created_at', e.created_at
          ) 
          ORDER BY e.created_at DESC
        ) FILTER (WHERE e.id IS NOT NULL) AS events
      FROM users u
      LEFT JOIN company_events e
        ON u.id = e.user_id
      WHERE u.role = 'Company' AND u.deleted_at IS NULL AND u.id = $1
      GROUP BY u.id, u.full_name;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Company not found' });
    }

    // If company exists but no events, set events to null
    if (!rows[0].events) {
      rows[0].events = null;
    }

    res.json({
      status: true,
      data: rows[0],
    });
  } catch (err) {
    console.error('❌ Error fetching events for company:', err.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.getUserEventBookings = async (req, res) => {
  const { id } = req.params; // user id

  try {
    const query = `
      SELECT 
        b.id AS booking_id,
        b.number_of_tickets,
        b.event_price,
        b.total_amount,
        b.created_at AS booking_date,
        e.id AS event_id,
        e.event_name,
        e.event_types,
        e.disability_types,
        e.accessibility_types,
        e.event_description,
        e.event_thumbnail,
        e.event_images,
        e.start_date,
        e.end_date,
        e.start_time,
        e.end_time,
        e.price_type,
        e.total_available_seats,
        e.event_address,
        e.how_to_reach_destination,
        c.id AS company_id,
        c.full_name AS company_name
      FROM event_bookings b
      JOIN company_events e ON b.event_id = e.id
      JOIN users c ON b.company_id = c.id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC;
    `;

    const { rows } = await pool.query(query, [id]);

    res.json({
      status: true,
      data: rows.length ? rows : null,
    });
  } catch (err) {
    console.error('❌ Error fetching user event bookings:', err.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.deleteEvent = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE company_events SET is_deleted = true WHERE id = $1 AND is_deleted IS false',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: false, message: 'Event not found or already deleted' });
    }

    return res.status(200).json({ status: true, message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting event:', error);
    return res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};


exports.getAllDrivers = async (req, res) => {
  try {
    const query = `
      SELECT 
        d.id,
        d.user_id,
        u.full_name,
        u.email,
        u.phone_number,
        u.role,
        d.vehicle_number,
        d.license_number,
        d.is_available,
        d.status,
        d.current_lat,
        d.current_lng,
        d.manufacturing_year,
        vm.name AS vehicle_model_name,
        mk.name AS vehicle_make_name,
        ct.name AS cab_type_name,
        d.license_photo_front,
        d.license_photo_back,
        d.rc_copy,
        d.insurance_copy,
        d.police_check_certificate,
        d.wwvp_card,
        d.created_at
      FROM drivers d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN vehicle_models vm ON d.vehicle_model_id = vm.id
      LEFT JOIN vehicle_makes mk ON d.vehicle_make_id = mk.id
      LEFT JOIN cab_types ct ON d.cab_type_id = ct.id
      ORDER BY d.id DESC;
    `;

    const result = await pool.query(query);

    return res.status(200).json({
      status: true,
      message: 'Drivers fetched successfully',
      data: result.rows,
    });
  } catch (error) {
    console.error('❌ Error fetching drivers:', error.message);
    return res.status(500).json({
      status: false,
      message: 'Error fetching drivers',
      error: error.message,
    });
  }
};

// ✅ Delete driver by ID (and optionally delete the user)
exports.deleteDriver = async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check driver exists
    const driverCheck = await client.query(
      `SELECT id, user_id FROM drivers WHERE id = $1`,
      [id]
    );

    if (driverCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        status: false,
        message: 'Driver not found',
      });
    }

    const userId = driverCheck.rows[0].user_id;

    // Delete driver
    await client.query(`DELETE FROM drivers WHERE id = $1`, [id]);

    // Optionally delete the linked user record
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await client.query('COMMIT');

    return res.status(200).json({
      status: true,
      message: 'Driver and linked user deleted successfully',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error deleting driver:', error.message);
    return res.status(500).json({
      status: false,
      message: 'Error deleting driver',
      error: error.message,
    });
  } finally {
    client.release();
  }
};


// ✅ Get Cab Owner Details (by user ID)
exports.getCabOwnerDetails = async (req, res) => {
  const { id } = req.params; // user_id (from users table)

  try {
    // 1️⃣ Fetch Owner + Driver Info
    const ownerQuery = `
      SELECT 
        u.id AS user_id,
        u.full_name,
        u.email,
        u.phone_number,
        u.role,
        u.is_verified,
        u.created_at AS user_created_at,
        d.id AS driver_id,
        d.vehicle_number,
        d.license_number,
        d.manufacturing_year,
        d.is_available,
        d.status,
        d.current_lat,
        d.current_lng,
        vm.name AS vehicle_model_name,
        mk.name AS vehicle_make_name,
        ct.name AS cab_type_name,
        d.license_photo_front,
        d.license_photo_back,
        d.rc_copy,
        d.insurance_copy,
        d.police_check_certificate,
        d.wwvp_card
      FROM drivers d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN vehicle_models vm ON d.vehicle_model_id = vm.id
      LEFT JOIN vehicle_makes mk ON d.vehicle_make_id = mk.id
      LEFT JOIN cab_types ct ON d.cab_type_id = ct.id
      WHERE u.id = $1
    `;

    const ownerResult = await pool.query(ownerQuery, [id]);

    if (ownerResult.rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: 'Cab Owner not found',
      });
    }

    const owner = ownerResult.rows[0];

    // 2️⃣ Fetch All Bookings by Driver
    const bookingsQuery = `
      SELECT 
        cb.id AS booking_id,
        cb.user_id,
        u2.full_name AS passenger_name,
        cb.cab_type_id,
        ct.name AS cab_type_name,
        cb.booking_type,
        cb.pickup_address,
        cb.drop_address,
        cb.distance_km,
        cb.estimated_fare,
        cb.scheduled_time,
        cb.status,
        cb.created_at,
        cb.updated_at
      FROM cab_bookings cb
      LEFT JOIN users u2 ON cb.user_id = u2.id
      LEFT JOIN cab_types ct ON cb.cab_type_id = ct.id
      WHERE cb.driver_id = $1
      ORDER BY cb.created_at DESC
    `;

    const bookingsResult = await pool.query(bookingsQuery, [owner.driver_id]);

    // 3️⃣ Build Image URLs
    const images = {
      license_photo_front: owner.license_photo_front ? `${BASE_IMAGE_URL}${owner.license_photo_front}` : null,
      license_photo_back: owner.license_photo_back ? `${BASE_IMAGE_URL}${owner.license_photo_back}` : null,
      rc_copy: owner.rc_copy ? `${BASE_IMAGE_URL}${owner.rc_copy}` : null,
      insurance_copy: owner.insurance_copy ? `${BASE_IMAGE_URL}${owner.insurance_copy}` : null,
      police_check_certificate: owner.police_check_certificate ? `${BASE_IMAGE_URL}${owner.police_check_certificate}` : null,
      wwvp_card: owner.wwvp_card ? `${BASE_IMAGE_URL}${owner.wwvp_card}` : null,
    };

    // 4️⃣ Return Unified Response
    return res.status(200).json({
      status: true,
      message: 'Cab Owner details with bookings fetched successfully',
      data: {
        id: owner.user_id,
        full_name: owner.full_name,
        email: owner.email,
        phone_number: owner.phone_number,
        role: owner.role,
        is_verified: owner.is_verified,
        vehicle_number: owner.vehicle_number,
        vehicle_make: owner.vehicle_make_name,
        vehicle_model: owner.vehicle_model_name,
        cab_type: owner.cab_type_name,
        manufacturing_year: owner.manufacturing_year,
        license_number: owner.license_number,
        status: owner.status,
        is_available: owner.is_available,
        current_location: {
          lat: owner.current_lat,
          lng: owner.current_lng,
        },
        images,
        bookings: bookingsResult.rows.map(b => ({
          id: b.booking_id,
          passenger_name: b.passenger_name,
          cab_type: b.cab_type_name,
          booking_type: b.booking_type,
          pickup_address: b.pickup_address,
          drop_address: b.drop_address,
          distance_km: b.distance_km,
          estimated_fare: b.estimated_fare,
          scheduled_time: b.scheduled_time,
          status: b.status,
          created_at: b.created_at,
          updated_at: b.updated_at,
        })),
      },
    });
  } catch (error) {
    console.error('❌ Error fetching Cab Owner details:', error.message);
    return res.status(500).json({
      status: false,
      message: 'Error fetching Cab Owner details',
      error: error.message,
    });
  }
};