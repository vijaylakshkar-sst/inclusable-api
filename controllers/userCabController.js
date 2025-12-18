const pool = require('../dbconfig');
const { sendNotification, sendNotificationToDriver } = require('../hooks/notification');

const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;

exports.findAvailableRides = async (req, res) => {
  const { lat, lng, radius_km = 10 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ status: false, message: 'Latitude and longitude are required' });
  }

  try {
    const client = await pool.connect();

    const query = `
      SELECT 
        d.*,
        c.name AS cab_type_name,
        c.thumbnail_url,
        c.standard_price,
        (
          6371 * acos(
            cos(radians($1)) * cos(radians(d.current_lat)) *
            cos(radians(d.current_lng) - radians($2)) +
            sin(radians($1)) * sin(radians(d.current_lat))
          )
        ) AS distance_km
      FROM drivers d
      LEFT JOIN cab_types c ON d.cab_type_id = c.id
      WHERE d.is_available = true
        AND d.status = 'online'
        AND (
          6371 * acos(
            cos(radians($1)) * cos(radians(d.current_lat)) *
            cos(radians(d.current_lng) - radians($2)) +
            sin(radians($1)) * sin(radians(d.current_lat))
          )
        ) <= $3
      ORDER BY distance_km ASC
      LIMIT 20;
    `;

    const result = await client.query(query, [lat, lng, radius_km]);

    client.release();

    if (result.rows.length === 0) {
      return res.status(200).json({
        status: false,
        message: 'No rides found near your location',
        data: [],
      });
    }

    res.status(200).json({
      status: true,
      message: 'Rides found successfully',
      data: result.rows,
    });

  } catch (err) {
    console.error('❌ FIND RIDES ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};


exports.findCabTypesWithFare = async (req, res) => {
  const {
    pickup_lat,
    pickup_lng,
    drop_lat,
    drop_lng,
  } = req.query;

  if (!pickup_lat || !pickup_lng || !drop_lat || !drop_lng) {
    return res.status(400).json({
      status: false,
      message: "Pickup and drop latitude & longitude are required",
    });
  }

  try {
    const client = await pool.connect();

    const query = `
      SELECT
        c.id,
        c.name,
        c.thumbnail_url,
        c.standard_price,
        c.disability_feature_price,

        (
          6371 * acos(
            cos(radians($1)) * cos(radians($3)) *
            cos(radians($4) - radians($2)) +
            sin(radians($1)) * sin(radians($3))
          )
        ) AS distance_km

      FROM cab_types c
      WHERE c.is_active = true;
    `;

    const result = await client.query(query, [
      pickup_lat,
      pickup_lng,
      drop_lat,
      drop_lng,
    ]);

    client.release();

    // 🔥 Transform response into two groups
    const standard_cabs = [];
    const disability_cabs = [];

    result.rows.forEach(cab => {
      const fullThumbnail =
        cab.thumbnail_url
          ? `${BASE_IMAGE_URL}/${cab.thumbnail_url}`
          : null;

      const distance = Number(cab.distance_km);

      // Standard cab pricing
      if (cab.standard_price) {
        standard_cabs.push({
          id: cab.id,
          name: cab.name,
          thumbnail_url: fullThumbnail,
          price_per_km: cab.standard_price,
          distance_km: distance,
          total_price: Math.round(distance * cab.standard_price),
        });
      }

      // Disability cab pricing
      if (cab.disability_feature_price) {
        disability_cabs.push({
          id: cab.id,
          name: cab.name,
          thumbnail_url: fullThumbnail,
          price_per_km: cab.disability_feature_price,
          distance_km: distance,
          total_price: Math.round(distance * cab.disability_feature_price),
        });
      }
    });

    // Sort by price (cheap → costly)
    standard_cabs.sort((a, b) => a.total_price - b.total_price);
    disability_cabs.sort((a, b) => a.total_price - b.total_price);

    res.status(200).json({
      status: true,
      message: "Cab types fetched successfully",
      data: {
        standard_cabs,
        disability_cabs,
      },
    });

  } catch (err) {
    console.error("❌ CAB FARE ERROR:", err.message);
    res.status(500).json({ status: false, message: "Server Error" });
  }
};


exports.bookCab = async (req, res) => {

  const user_id = req.user?.userId;
  const {
    cab_type_id,
    booking_type,
    booking_mode,
    pickup_address,
    pickup_lat,
    pickup_lng,
    drop_address,
    drop_lat,
    drop_lng,
    disability_features_id,
    scheduled_time
  } = req.body;

  if (
    !cab_type_id || !booking_type ||
    !pickup_address || !pickup_lat || !pickup_lng ||
    !drop_address || !drop_lat || !drop_lng
  ) {
    return res.status(400).json({ status: false, message: 'Missing required fields' });
  }

  if (!['instant', 'later'].includes(booking_type)) {
    return res.status(400).json({ status: false, message: 'Invalid booking_type. Use instant or later.' });
  }

  if (booking_type === 'later' && !scheduled_time) {
    return res.status(400).json({ status: false, message: 'Scheduled time is required for later bookings' });
  }

  if (!['cash', 'credit card', 'other'].includes(booking_mode)) {
    return res.status(400).json({ status: false, message: 'Invalid booking_mode. Use cash, credit card , other.' });
  }

  try {
    const client = await pool.connect();

    // ✅ Check if user exists
    const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // ✅ Check if cab type exists
    const cabCheck = await client.query('SELECT * FROM cab_types WHERE id = $1', [cab_type_id]);
    if (cabCheck.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Cab type not found' });
    }

    const cabType = cabCheck.rows[0];

    // ✅ Calculate distance using Haversine formula (server-side)
    const rad = Math.PI / 180;
    const R = 6371; // Earth radius in km

    const dLat = (drop_lat - pickup_lat) * rad;
    const dLng = (drop_lng - pickup_lng) * rad;

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(pickup_lat * rad) * Math.cos(drop_lat * rad) *
      Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance_km = parseFloat((R * c).toFixed(2));

    const estimated_fare = parseFloat((cabType.base_fare || 0 + distance_km * cabType.standard_price).toFixed(2));

    let driverId = null;

    // ✅ Assign driver only if booking_type = instant
    if (booking_type === 'instant') {

      let driverQuery = `
        SELECT d.id,
          (
            6371 * acos(
              cos(radians($1)) * cos(radians(d.current_lat)) *
              cos(radians(d.current_lng) - radians($2)) +
              sin(radians($1)) * sin(radians(d.current_lat))
            )
          ) AS distance_km
        FROM drivers d
      `;

      const params = [pickup_lat, pickup_lng, cab_type_id];
      let paramIndex = 4;

      // ✅ Join only if disability feature is selected
      if (disability_features_id) {
        driverQuery += `
          INNER JOIN driver_disability_features ddf
            ON ddf.driver_id = d.id
          AND ddf.disability_feature_id = $${paramIndex}
        `;
        params.push(disability_features_id);
        paramIndex++;
      }

      driverQuery += `
        WHERE d.is_available = true
          AND d.status = 'online'
          AND d.cab_type_id = $3
        ORDER BY distance_km ASC
        LIMIT 1;
      `;

      const driverRes = await client.query(driverQuery, params);

      if (driverRes.rows.length === 0) {
        return res.status(404).json({
          status: false,
          message: disability_features_id
            ? 'No nearby drivers available with selected disability feature'
            : 'No nearby drivers available for this cab type',
        });
      }

      driverId = driverRes.rows[0].id;

      // 🔒 Make driver unavailable
      await client.query(
        'UPDATE drivers SET is_available = false WHERE id = $1',
        [driverId]
      );
    }

    const booking_otp = Math.floor(1000 + Math.random() * 9000);

    const result = await client.query(
      `
      INSERT INTO cab_bookings (
        user_id, driver_id, cab_type_id, booking_type,
        pickup_address, pickup_lat, pickup_lng,
        drop_address, drop_lat, drop_lng,
        scheduled_time, distance_km, estimated_fare, status,
        booking_mode, booking_otp, disability_features_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *;
      `,
      [
        user_id,
        driverId,
        cab_type_id,
        booking_type,
        pickup_address,
        pickup_lat,
        pickup_lng,
        drop_address,
        drop_lat,
        drop_lng,
        scheduled_time || null,
        distance_km,
        estimated_fare,
        booking_type === 'instant' ? 'pending' : 'scheduled',
        booking_mode,
        booking_otp,
        disability_features_id || null
      ]
    );

    const booking = result.rows[0];

    const driverResult = await client.query(
      'SELECT id,user_id FROM drivers WHERE id = $1 LIMIT 1',
      [driverId]
    );

    if (driverResult.rowCount === 0) {
      return res.status(404).json({
        status: false,
        message: 'Driver not found for this user'
      });
    }

    const driver_user_id = driverResult.rows[0].user_id;

    // Send notification to driver if assigned
    if (driverId) {
      await sendNotificationToDriver({
        driverUserId: driver_user_id,
        title: 'New Ride Assigned',
        message: 'You have been assigned a new booking. Tap to view details.',
        type: 'Booking',
        booking_id: booking.id,
        image_url: `${BASE_IMAGE_URL}/icons/check-circle.png`,
        bg_color: '#1FB23F',
        data: {
          screen: 'BookingDetails',
          sound: 'default'
        }
      });
    }

    res.status(201).json({
      status: true,
      message: `Your ${cabType.name} cab has been booked.`,
      data: result.rows[0],
    });

    client.release();
  } catch (err) {
    console.error('❌ BOOK CAB ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};

exports.cancelBooking = async (req, res) => {
  const { booking_id } = req.params;

  try {
    const client = await pool.connect();

    // Fetch booking
    const bookingRes = await client.query('SELECT * FROM cab_bookings WHERE id = $1', [booking_id]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Booking not found' });
    }
    const booking = bookingRes.rows[0];

    if (['completed', 'cancelled'].includes(booking.status)) {
      return res.status(400).json({ status: false, message: 'Booking cannot be cancelled' });
    }

    // Update booking status
    await client.query(
      'UPDATE cab_bookings SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['cancelled', booking_id]
    );

    // Make driver available if assigned
    if (booking.driver_id) {
      await client.query('UPDATE drivers SET is_available = true WHERE id = $1', [booking.driver_id]);
    }

    const driverId = booking.driver_id;

    const driverResult = await client.query(
      'SELECT id,user_id FROM drivers WHERE id = $1 LIMIT 1',
      [driverId]
    );

    if (driverResult.rowCount === 0) {
      return res.status(404).json({
        status: false,
        message: 'Driver not found for this user'
      });
    }

    const driver_user_id = driverResult.rows[0].user_id;


    if (driverId) {
      await sendNotificationToDriver({
        driverUserId: driver_user_id,
        title: 'Booking Cancelled',
        message: `Booking #${booking.id} has been cancelled.`,
        type: 'Booking',
        booking_id: booking.id,
        image_url: `${BASE_IMAGE_URL}/icons/check-xmark.png`,
        bg_color: '#DF1D17',
        data: {
          screen: 'BookingDetails',
          sound: 'default',
        }
      });
    }

    res.status(200).json({ status: true, message: 'Booking cancelled successfully' });

    client.release();
  } catch (err) {
    console.error('❌ CANCEL BOOKING ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};


exports.trackDriver = async (req, res) => {
  const { booking_id } = req.params;

  try {
    const client = await pool.connect();

    const bookingRes = await client.query(
      `SELECT b.id, b.status, b.driver_id, d.current_lat, d.current_lng
       FROM cab_bookings b
       LEFT JOIN drivers d ON b.driver_id = d.id
       WHERE b.id = $1`,
      [booking_id]
    );

    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Booking not found' });
    }

    const booking = bookingRes.rows[0];

    if (!booking.driver_id || ['pending', 'scheduled'].includes(booking.status)) {
      return res.status(400).json({ status: false, message: 'Driver not yet assigned' });
    }

    res.status(200).json({
      status: true,
      message: 'Driver location fetched successfully',
      data: {
        driver_id: booking.driver_id,
        lat: booking.current_lat,
        lng: booking.current_lng,
        status: booking.status
      }
    });

    client.release();
  } catch (err) {
    console.error('❌ DRIVER TRACKING ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};


exports.cabTypes = async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM cab_types ORDER BY id ASC');
    res.json({ status: true, data: result.rows });
    client.release();
  } catch (err) {
    console.error('❌ READ ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};

exports.getDisabilityFeaturs = async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name FROM disability_features ORDER BY name ASC`);
    res.json({ status: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};