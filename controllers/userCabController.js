const pool = require('../dbconfig');
const { sendNotification } = require('../hooks/notification');

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
        c.fare_per_km,
        c.seating_capacity,
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


exports.bookCab = async (req, res) => {
  const {
    user_id,
    cab_type_id,
    booking_type,
    pickup_address,
    pickup_lat,
    pickup_lng,
    drop_address,
    drop_lat,
    drop_lng,
    scheduled_time
  } = req.body;

  if (
    !user_id || !cab_type_id || !booking_type ||
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

    const estimated_fare = parseFloat((cabType.base_fare + distance_km * cabType.fare_per_km).toFixed(2));

    let driverId = null;

    // ✅ Assign driver only if booking_type = instant
    if (booking_type === 'instant') {
      const driverQuery = `
        SELECT id,
          (
            6371 * acos(
              cos(radians($1)) * cos(radians(current_lat)) *
              cos(radians(current_lng) - radians($2)) +
              sin(radians($1)) * sin(radians(current_lat))
            )
          ) AS distance_km
        FROM drivers
        WHERE is_available = true AND status = 'online' AND cab_type_id = $3
        ORDER BY distance_km ASC
        LIMIT 1;
      `;

      const driverRes = await client.query(driverQuery, [pickup_lat, pickup_lng, cab_type_id]);

      if (driverRes.rows.length === 0) {
        return res.status(404).json({
          status: false,
          message: 'No nearby drivers available for this cab type',
        });
      }

      driverId = driverRes.rows[0].id;

      // Mark driver unavailable
      await client.query('UPDATE drivers SET is_available = false WHERE id = $1', [driverId]);
    }

    const result = await client.query(
      `
      INSERT INTO cab_bookings (
        user_id, driver_id, cab_type_id, booking_type,
        pickup_address, pickup_lat, pickup_lng,
        drop_address, drop_lat, drop_lng,
        scheduled_time, distance_km, estimated_fare, status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
      ]
    );

    const booking = result.rows[0];

    await sendNotification({
        user_id,
        booking_id: booking.id,
        title: 'Cab Booked',
        message: `Your ${cabType.name} cab has been booked.`,
        type: 'booking',
        target: 'user'
        });

        // Send notification to driver if assigned
        if (driverId) {
            await sendNotification({
                driver_id: driverId,
                booking_id: booking.id,
                title: 'New Ride Assigned',
                message: `You have a new ride for booking #${booking.id}.`,
                type: 'booking',
                target: 'driver'
            });
        }

    res.status(201).json({
      status: true,
      message: 'Cab booking successful',
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

    // Send notifications
    await sendNotification({
      user_id: booking.user_id,
      booking_id: booking.id,
      title: 'Booking Cancelled',
      message: 'Your cab booking has been cancelled.',
      type: 'booking',
      target: 'user'
    });

    if (booking.driver_id) {
      await sendNotification({
        driver_id: booking.driver_id,
        booking_id: booking.id,
        title: 'Booking Cancelled',
        message: `Booking #${booking.id} has been cancelled.`,
        type: 'booking',
        target: 'driver'
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
