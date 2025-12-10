
const pool = require('../dbconfig');
const { sendNotification, sendNotificationToUser } = require('../hooks/notification');
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;
// ✅ Create/Update Helper for image uploads (middleware sends file paths)
const getFilePath = (file) => (file ? `/drivers/${file.filename}` : null);


// ===========================================================
//  POST /cab-register
// ===========================================================
exports.addProfile = async (req, res) => {
    const client = await pool.connect();
    const user_id = req.user?.userId;

    if (!user_id) {
        return res.status(401).json({ status: false, error: 'Unauthorized' });
    }
    try {
        await client.query('BEGIN');

        // 🔍 0️⃣ Check if driver already exists for this user
        const existingDriver = await client.query(
            'SELECT id FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (existingDriver.rowCount > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                status: false,
                message: 'Driver already registered. Please update your profile.'
            });
        }



        const {
            cab_type_id,
            license_number,
            vehicle_number,
            vehicle_make_id,
            vehicle_model_id,
            manufacturing_year,
            disability_features
        } = req.body;

        // Uploaded files
        const license_photo_front = getFilePath(req.files?.license_photo_front?.[0]);
        const license_photo_back = getFilePath(req.files?.license_photo_back?.[0]);
        const rc_copy = getFilePath(req.files?.rc_copy?.[0]);
        const insurance_copy = getFilePath(req.files?.insurance_copy?.[0]);
        const police_check_certificate = getFilePath(req.files?.police_check_certificate?.[0]);
        const wwvp_card = getFilePath(req.files?.wwvp_card?.[0]);

        // 1️⃣ Insert into drivers
        const insertDriver = `
      INSERT INTO drivers (
        user_id, cab_type_id, license_number, vehicle_number,
        license_photo_front, license_photo_back, rc_copy, insurance_copy,
        police_check_certificate, wwvp_card,
        vehicle_make_id, vehicle_model_id, manufacturing_year
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id;
    `;

        const driverRes = await client.query(insertDriver, [
            user_id,
            cab_type_id,
            license_number,
            vehicle_number,
            license_photo_front,
            license_photo_back,
            rc_copy,
            insurance_copy,
            police_check_certificate,
            wwvp_card,
            vehicle_make_id,
            vehicle_model_id,
            manufacturing_year
        ]);

        const driverId = driverRes.rows[0].id;

        // 2️⃣ Insert multiple disability features for this driver
        // (disability_features should be an array of feature IDs)
        if (disability_features && disability_features.length > 0) {
            const features =
                typeof disability_features === 'string'
                    ? JSON.parse(disability_features)
                    : disability_features;

            for (const featureId of features) {
                await client.query(
                    `INSERT INTO driver_disability_features (driver_id, disability_feature_id)
           VALUES ($1, $2)`,
                    [driverId, featureId]
                );
            }
        }

        await client.query('COMMIT');

        res.status(201).json({
            status: true,
            message: 'Driver profile registered successfully',
            driver_id: driverId
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error registering driver:', err.message);
        res.status(500).json({ status: false, message: err.message });
    } finally {
        client.release();
    }
};

// ===========================================================
//  GET /cab-profile/:id
// ===========================================================
exports.getProfile = async (req, res) => {
    const user_id = req.user?.userId;
    if (!user_id) {
        return res.status(401).json({ status: false, error: 'Unauthorized' });
    }

    try {
        // Get base URL from request (auto works on local + prod)   

        // 🔹 Step 1: Fetch main driver profile with make/model names
        const driverQuery = `
      SELECT 
        d.*,
        vm.name AS vehicle_model_name,
        mk.name AS vehicle_make_name
      FROM drivers d
      LEFT JOIN vehicle_models vm ON d.vehicle_model_id = vm.id
      LEFT JOIN vehicle_makes mk ON d.vehicle_make_id = mk.id
      WHERE d.user_id = $1
      LIMIT 1;
    `;

        const driverResult = await pool.query(driverQuery, [user_id]);

        if (driverResult.rowCount === 0) {
            return res.status(404).json({
                status: false,
                message: 'Driver not found'
            });
        }

        const driver = driverResult.rows[0];

        // 🔹 Step 2: Fetch disability features for this driver
        const featuresQuery = `
      SELECT df.id, df.name
      FROM driver_disability_features ddf
      JOIN disability_features df ON ddf.disability_feature_id = df.id
      WHERE ddf.driver_id = $1;
    `;
        const featuresResult = await pool.query(featuresQuery, [driver.id]);

        driver.disability_features = featuresResult.rows;

        // 🔹 Step 3: Attach full URLs for image fields
        const fileFields = [
            'license_photo_front',
            'license_photo_back',
            'rc_copy',
            'insurance_copy',
            'police_check_certificate',
            'wwvp_card'
        ];

        fileFields.forEach((field) => {
            if (driver[field]) {
                // remove leading slash if needed
                const cleanPath = driver[field].replace(/^\/+/, '');
                driver[field] = `${BASE_IMAGE_URL}/${cleanPath}`;
            }
        });

        // 🔹 Step 4: Send response
        res.json({
            status: true,
            data: driver
        });
    } catch (err) {
        console.error('❌ Error fetching driver profile:', err.message);
        res.status(500).json({ status: false, message: err.message });
    }
};

// ===========================================================
//  PUT /cab-profile/update/:id
// ===========================================================
exports.updateProfile = async (req, res) => {
    const client = await pool.connect();
    const user_id = req.user?.userId;

    if (!user_id) {
        return res.status(401).json({ status: false, error: 'Unauthorized' });
    }

    try {
        await client.query('BEGIN');

        // 🔹 1️⃣ Get existing driver for this user
        const existingDriver = await client.query(
            'SELECT id FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (existingDriver.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                status: false,
                message: 'Driver profile not found. Please register first.'
            });
        }

        const driverId = existingDriver.rows[0].id;

        // 🔹 2️⃣ Extract body fields
        const {
            cab_type_id,
            license_number,
            vehicle_number,
            vehicle_make_id,
            vehicle_model_id,
            manufacturing_year,
            disability_features
        } = req.body;

        // 🔹 3️⃣ Uploaded files
        const license_photo_front = getFilePath(req.files?.license_photo_front?.[0]);
        const license_photo_back = getFilePath(req.files?.license_photo_back?.[0]);
        const rc_copy = getFilePath(req.files?.rc_copy?.[0]);
        const insurance_copy = getFilePath(req.files?.insurance_copy?.[0]);
        const police_check_certificate = getFilePath(req.files?.police_check_certificate?.[0]);
        const wwvp_card = getFilePath(req.files?.wwvp_card?.[0]);

        // 🔹 4️⃣ Update driver details
        await client.query(
            `
      UPDATE drivers SET
        cab_type_id = COALESCE($1, cab_type_id),
        license_number = COALESCE($2, license_number),
        vehicle_number = COALESCE($3, vehicle_number),
        vehicle_make_id = COALESCE($4, vehicle_make_id),
        vehicle_model_id = COALESCE($5, vehicle_model_id),
        manufacturing_year = COALESCE($6, manufacturing_year),
        license_photo_front = COALESCE($7, license_photo_front),
        license_photo_back = COALESCE($8, license_photo_back),
        rc_copy = COALESCE($9, rc_copy),
        insurance_copy = COALESCE($10, insurance_copy),
        police_check_certificate = COALESCE($11, police_check_certificate),
        wwvp_card = COALESCE($12, wwvp_card),
        updated_at = NOW()
      WHERE user_id = $13
    `,
            [
                cab_type_id,
                license_number,
                vehicle_number,
                vehicle_make_id,
                vehicle_model_id,
                manufacturing_year,
                license_photo_front,
                license_photo_back,
                rc_copy,
                insurance_copy,
                police_check_certificate,
                wwvp_card,
                user_id
            ]
        );

        // 🔹 5️⃣ Update disability features (many-to-many mapping)
        if (disability_features && disability_features.length > 0) {
            const features =
                typeof disability_features === 'string'
                    ? JSON.parse(disability_features)
                    : disability_features;

            // Remove existing features for this driver
            await client.query(
                'DELETE FROM driver_disability_features WHERE driver_id = $1',
                [driverId]
            );

            // Add new mappings
            for (const featureId of features) {
                await client.query(
                    `
          INSERT INTO driver_disability_features (driver_id, disability_feature_id)
          VALUES ($1, $2)
        `,
                    [driverId, featureId]
                );
            }
        }

        await client.query('COMMIT');

        res.status(200).json({
            status: true,
            message: 'Driver profile updated successfully'
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error updating driver profile:', err.message);
        res.status(500).json({ status: false, message: err.message });
    } finally {
        client.release();
    }
};

exports.getBookings = async (req, res) => {
    const user_id = req.user?.userId; // from auth middleware

    if (!user_id) {
        return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const client = await pool.connect();

    try {
        // Step 1️⃣: Get driver_id linked to this user
        const driverResult = await client.query(
            'SELECT id FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (driverResult.rowCount === 0) {
            return res.status(404).json({
                status: false,
                message: 'Driver not found. Please register your profile first.'
            });
        }

        const driverId = driverResult.rows[0].id;

        // Step 2️⃣: Fetch all bookings for this driver
        const query = `
      SELECT 
        b.id,
        b.booking_type,
        b.pickup_address,
        b.drop_address,
        b.pickup_lat,
        b.pickup_lng,
        b.drop_lat,
        b.drop_lng,
        b.scheduled_time,
        b.distance_km,
        b.estimated_fare,
        b.status,
        b.booking_mode,
        b.booking_otp,
        b.booking_verified,
        b.created_at,
        u.full_name AS passenger_name,
        u.phone_number AS passenger_phone,
        ct.name AS cab_type_name
      FROM cab_bookings b
      LEFT JOIN users u ON b.user_id = u.id
      LEFT JOIN cab_types ct ON b.cab_type_id = ct.id
      WHERE b.driver_id = $1 AND b.status = 'pending'
      ORDER BY b.created_at DESC;
    `;

        const bookings = await client.query(query, [driverId]);

        // Step 3️⃣: Return response
        res.status(200).json({
            status: true,
            data: {
                count: bookings.rowCount,
                data: bookings.rows
            }
        });
    } catch (err) {
        console.error('❌ Error fetching driver bookings:', err.message);
        res.status(500).json({
            status: false,
            message: 'Server error while fetching bookings',
            error: err.message
        });
    } finally {
        client.release();
    }
};

exports.updateLocation = async (req, res) => {
    const user_id = req.user?.userId; // From auth middleware

    if (!user_id) {
        return res.status(401).json({ status: false, error: 'Unauthorized' });
    }

    const { current_lat, current_lng } = req.body;

    if (!current_lat || !current_lng) {
        return res.status(400).json({
            status: false,
            message: 'Latitude and longitude are required'
        });
    }

    const client = await pool.connect();

    try {
        // 1️⃣ Get driver_id for this user
        const driverResult = await client.query(
            'SELECT id FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (driverResult.rowCount === 0) {
            return res.status(404).json({
                status: false,
                message: 'Driver not found for this user'
            });
        }

        const driver_id = driverResult.rows[0].id;

        // 2️⃣ Update current location
        await client.query(
            `
      UPDATE drivers
      SET current_lat = $1,
          current_lng = $2,
          updated_at = NOW()
      WHERE id = $3
    `,
            [current_lat, current_lng, driver_id]
        );

        res.status(200).json({
            status: true,
            message: 'Driver location updated successfully',
            data: {
                driver_id,
                current_lat,
                current_lng
            }
        });
    } catch (err) {
        console.error('❌ Error updating driver location:', err.message);
        res.status(500).json({ status: false, message: err.message });
    } finally {
        client.release();
    }
};


exports.updateStatus = async (req, res) => {
    const user_id = req.user?.userId; // from auth middleware

    if (!user_id) {
        return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const { status } = req.body;

    // Validate input
    if (!status || !['online', 'offline'].includes(status)) {
        return res.status(400).json({
            status: false,
            message: "Invalid status. Must be either 'online' or 'offline'."
        });
    }

    const client = await pool.connect();

    try {
        // 1️⃣ Find driver by user_id
        const driverRes = await client.query(
            'SELECT id FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (driverRes.rowCount === 0) {
            return res.status(404).json({
                status: false,
                message: 'Driver not found. Please complete profile first.'
            });
        }

        const driver_id = driverRes.rows[0].id;

        await client.query(
            `
      UPDATE drivers
      SET status = $1,
          updated_at = NOW()
      WHERE id = $2
    `,
            [status, driver_id]
        );

        res.status(200).json({
            status: true,
            message: `Driver status updated to ${status}`,
            data: {
                driver_id,
                status
            }
        });
    } catch (err) {
        console.error('❌ Error updating driver status:', err.message);
        res.status(500).json({ status: false, message: err.message });
    } finally {
        client.release();
    }
};

exports.acceptBooking = async (req, res) => {
    const user_id = req.user?.userId;
    const { bookingId } = req.params;

    if (!user_id) {
        return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const client = await pool.connect();

    try {
        // Step 1️⃣: Get driver_id for this user
        const driverRes = await client.query(
            'SELECT * FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (driverRes.rowCount === 0) {
            return res.status(404).json({ status: false, message: 'Driver profile not found' });
        }

        const driverId = driverRes.rows[0].id;

        // Step 2️⃣: Fetch the booking
        const bookingRes = await client.query(
            'SELECT id, user_id, status FROM cab_bookings WHERE id = $1 LIMIT 1',
            [bookingId]
        );

        if (bookingRes.rowCount === 0) {
            return res.status(404).json({ status: false, message: 'Booking not found' });
        }

        const booking = bookingRes.rows[0];
        if (booking.status !== 'pending') {
            return res.status(400).json({
                status: false,
                message: `Booking cannot be accepted. Current status: ${booking.status}`
            });
        }

        // Step 3️⃣: Accept booking
        await client.query(
            `UPDATE cab_bookings
            SET driver_id = $1,
                status = 'accepted',
                updated_at = NOW()
            WHERE id = $2
            `,
            [driverId, bookingId]
        );     

        const vehicle_number = driverRes.rows[0].vehicle_number;

        // Step 5️⃣: Send notification to passenger
        const title = 'Your Ride Has Been Accepted 🚗';
        const message = `${driverRes.license_number ? 'Driver' : 'Your driver'} has accepted your booking. Vehicle Number: ${vehicle_number || 'N/A'}`;
        
        await sendNotificationToUser({
        userId: booking.user_id,
        title,
        message,
        type: 'Booking',
        target: 'NDIS Member',
        booking_id: booking.id,
        });

        

        res.status(200).json({
            status: true,
            message: 'Booking accepted successfully',
            data: {
                booking_id: bookingId,
                driver_id: driverId,
                status: 'accepted'
            }
        });
    } catch (err) {
        console.error('❌ Error accepting booking:', err);
        res.status(500).json({ status: false, message: err.message });
    } finally {
        client.release();
    }
};

exports.ignoreBooking = async (req, res) => {
    const user_id = req.user?.userId;
    const { bookingId } = req.params;

    if (!user_id) {
        return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const client = await pool.connect();

    try {
        // Step 1️⃣: Find driver
        const driverRes = await client.query(
            'SELECT id FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (driverRes.rowCount === 0) {
            return res.status(404).json({ status: false, message: 'Driver profile not found' });
        }

        const driverId = driverRes.rows[0].id;

        // Step 2️⃣: Check booking
        const bookingRes = await client.query(
            'SELECT id, status FROM cab_bookings WHERE id = $1 LIMIT 1',
            [bookingId]
        );

        if (bookingRes.rowCount === 0) {
            return res.status(404).json({ status: false, message: 'Booking not found' });
        }

        const booking = bookingRes.rows[0];
        if (booking.status !== 'pending') {
            return res.status(400).json({
                status: false,
                message: `Booking cannot be ignored. Current status: ${booking.status}`
            });
        }

        // Step 3️⃣: Mark as ignored
        await client.query(
            `
            UPDATE cab_bookings
            SET status = 'cancelled',
                updated_at = NOW()
            WHERE id = $1
            `,
            [bookingId]
        );       

        res.status(200).json({
            status: true,
            message: 'Booking ignored successfully',
            data: {
                booking_id: bookingId,
                driver_id: driverId,
                status: 'cancelled'
            }
        });
    } catch (err) {
        console.error('❌ Error ignoring booking:', err.message);
        res.status(500).json({ status: false, message: err.message });
    } finally {
        client.release();
    }
};


exports.verifyBookingOtp = async (req, res) => {
    const user_id = req.user?.userId; // from auth middleware
    const { bookingId } = req.params;
    const { otp } = req.body;

    if (!user_id) {
        return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    if (!otp) {
        return res.status(400).json({ status: false, message: 'OTP is required' });
    }

    const client = await pool.connect();

    try {
        // 1️⃣ Get driver_id for this user
        const driverRes = await client.query(
            'SELECT id FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (driverRes.rowCount === 0) {
            return res.status(404).json({ status: false, message: 'Driver not found' });
        }

        const driverId = driverRes.rows[0].id;

        // 2️⃣ Get booking details
        const bookingRes = await client.query(
            'SELECT id, booking_otp, booking_verified, driver_id, status FROM cab_bookings WHERE id = $1',
            [bookingId]
        );

        if (bookingRes.rowCount === 0) {
            return res.status(404).json({ status: false, message: 'Booking not found' });
        }

        const booking = bookingRes.rows[0];

        // 3️⃣ Check booking validity
        if (booking.driver_id !== driverId) {
            return res.status(403).json({
                status: false,
                message: 'This booking is not assigned to you'
            });
        }

        if (booking.booking_verified) {
            return res.status(400).json({
                status: false,
                message: 'OTP already verified for this booking'
            });
        }

        if (booking.status !== 'accepted') {
            return res.status(400).json({
                status: false,
                message: `Booking cannot be verified in status: ${booking.status}`
            });
        }

        // 4️⃣ Verify OTP
        if (booking.booking_otp !== otp) {
            return res.status(400).json({
                status: false,
                message: 'Invalid OTP. Please check and try again.'
            });
        }

        // 5️⃣ Mark as verified & update booking status to in_progress
        await client.query(
            `
      UPDATE cab_bookings
      SET booking_verified = TRUE,
          status = 'in_progress',
          updated_at = NOW()
      WHERE id = $1
    `,
            [bookingId]
        );

        const title = 'Started!';
        const message = `Your Ride Has Been Started.`;

        await sendNotificationToUser({
            userId: booking.user_id,
            title,
            message,
            type: 'Booking',
            target: 'NDIS Member',
            booking_id: booking.id,
            data: { status: 'complete' },
        });

        res.status(200).json({
            status: true,
            message: 'Booking OTP verified successfully. Ride started.',
            data: {
                booking_id: bookingId,
                status: 'in_progress',
                booking_verified: true
            }
        });
    } catch (err) {
        console.error('❌ Error verifying booking OTP:', err.message);
        res.status(500).json({ status: false, message: err.message });
    } finally {
        client.release();
    }
};

exports.completeRide = async (req, res) => {
    const user_id = req.user?.userId;
    const { bookingId } = req.params;
    const { distance_km, total_fare } = req.body; // Optional input

    if (!user_id) {
        return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const client = await pool.connect();

    try {
        // 1️⃣ Get driver's record
        const driverRes = await client.query(
            'SELECT id FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (driverRes.rowCount === 0) {
            return res.status(404).json({ status: false, message: 'Driver not found' });
        }

        const driverId = driverRes.rows[0].id;

        // 2️⃣ Get booking details
        const bookingRes = await client.query(
            'SELECT id, status, driver_id FROM cab_bookings WHERE id = $1 LIMIT 1',
            [bookingId]
        );

        if (bookingRes.rowCount === 0) {
            return res.status(404).json({ status: false, message: 'Booking not found' });
        }

        const booking = bookingRes.rows[0];

        if (booking.driver_id !== driverId) {
            return res.status(403).json({
                status: false,
                message: 'This booking does not belong to you.'
            });
        }

        if (booking.status !== 'in_progress') {
            return res.status(400).json({
                status: false,
                message: `Ride cannot be completed. Current status: ${booking.status}`
            });
        }

        // 3️⃣ Complete ride
        const updateQuery = `
      UPDATE cab_bookings
      SET status = 'completed',
          distance_km = COALESCE($1, distance_km),
          estimated_fare = COALESCE($2, estimated_fare),
          updated_at = NOW()
      WHERE id = $3
    `;

        await client.query(updateQuery, [distance_km, total_fare, bookingId]);

        // 4️⃣ (Optional) Make driver available again
        await client.query(
            `UPDATE drivers SET is_available = TRUE, status = 'online', updated_at = NOW() WHERE id = $1`,
            [driverId]
        );

        const title = 'Completed!';
        const message = `Your Ride Has Been Completed.`;

        await sendNotificationToUser({
            userId: booking.user_id,
            title,
            message,
            type: 'Booking',
            target: 'NDIS Member',
            booking_id: booking.id,
            data: { status: 'complete' },
        });

        res.status(200).json({
            status: true,
            message: 'Ride completed successfully',
            data: {
                booking_id: bookingId,
                status: 'completed',
                distance_km,
                total_fare
            }
        });
    } catch (err) {
        console.error('❌ Error completing ride:', err.message);
        res.status(500).json({ status: false, message: err.message });
    } finally {
        client.release();
    }
};

exports.cancelRide = async (req, res) => {
  const user_id = req.user?.userId;
  const { bookingId } = req.params;

  if (!user_id) {
    return res.status(401).json({ status: false, message: 'Unauthorized' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Get driver record
    const driverRes = await client.query(
      'SELECT id, vehicle_number FROM drivers WHERE user_id = $1 LIMIT 1',
      [user_id]
    );

    if (driverRes.rowCount === 0) {
      return res.status(404).json({ status: false, message: 'Driver not found' });
    }

    const driver = driverRes.rows[0];
    const driverId = driver.id;

    // 2️⃣ Fetch booking
    const bookingRes = await client.query(
      'SELECT * FROM cab_bookings WHERE id = $1 LIMIT 1',
      [bookingId]
    );

    if (bookingRes.rowCount === 0) {
      return res.status(404).json({ status: false, message: 'Booking not found' });
    }

    const booking = bookingRes.rows[0];

    if (booking.driver_id !== driverId) {
      return res.status(403).json({
        status: false,
        message: 'This booking does not belong to you.',
      });
    }

    if (!['pending', 'accepted', 'in_progress'].includes(booking.status)) {
      return res.status(400).json({
        status: false,
        message: `Booking cannot be cancelled. Current status: ${booking.status}`,
      });
    }

        await client.query(
        `
        UPDATE cab_bookings
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE id = $1
        `,
        [bookingId]
        );

    // 4️⃣ Mark driver as available again
    await client.query(
      `UPDATE drivers SET is_available = TRUE, status = 'online', updated_at = NOW() WHERE id = $1`,
      [driverId]
    );

    // 5️⃣ Notify the NDIS Member (user)
    const userRes = await client.query(
      `SELECT id, full_name, fcm_token FROM users WHERE id = $1 LIMIT 1`,
      [booking.user_id]
    );
   
    const title = 'Your Ride Has Been Cancelled ❌';
    const message = `Your driver cancelled the booking.`;

    await sendNotificationToUser({
      userId: booking.user_id,
      title,
      message,
      type: 'Booking',
      target: 'NDIS Member',
      booking_id: booking.id,
      data: { status: 'cancelled' },
    });

    await client.query('COMMIT');

    res.status(200).json({
      status: true,
      message: 'Ride cancelled successfully',
      data: {
        booking_id: bookingId,
        status: 'cancelled'        
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error cancelling ride:', err.message);
    res.status(500).json({ status: false, message: err.message });
  } finally {
    client.release();
  }
};


exports.getHistory = async (req, res) => {
    const user_id = req.user?.userId;
    const { date } = req.query; // optional ?date=YYYY-MM-DD

    if (!user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const client = await pool.connect();

    try {
        // Step 1️⃣: Get driver ID
        const driverRes = await client.query(
            'SELECT id FROM drivers WHERE user_id = $1 LIMIT 1',
            [user_id]
        );

        if (driverRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        const driverId = driverRes.rows[0].id;

        // Step 2️⃣: Build date filter
        let dateFilter = '';
        let params = [driverId];

        if (date) {
            dateFilter = `AND DATE(b.completed_at) = $2`;
            params.push(date);
        }

        // Step 3️⃣: Fetch summary stats
        const summaryQuery = `
      SELECT 
        COUNT(*) AS total_jobs,
        COALESCE(SUM(b.estimated_fare), 0) AS total_earnings
      FROM cab_bookings b
      WHERE b.driver_id = $1 AND b.status = 'completed' ${date ? 'AND DATE(b.updated_at) = $2' : ''}
    `;
        const summaryRes = await client.query(summaryQuery, params);

        // Step 4️⃣: Fetch ride list
        const ridesQuery = `
      SELECT 
        b.id AS booking_id,
        b.pickup_address,
        b.drop_address,
        b.distance_km,
        b.estimated_fare AS fare,
        b.status,
        b.booking_mode,
        b.updated_at AS completed_at,
        u.full_name AS passenger_name,
        u.profile_image AS passenger_image
      FROM cab_bookings b
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.driver_id = $1 AND b.status = 'completed' ${date ? 'AND DATE(b.updated_at) = $2' : ''}
      ORDER BY b.updated_at DESC;
    `;
        const ridesRes = await client.query(ridesQuery, params);

        ridesRes.rows.forEach((r) => {
            if (r.passenger_image) {
                r.passenger_image = `${BASE_IMAGE_URL}/${r.passenger_image.replace(/^\/+/, '')}`;
            }
        });

        // Step 6️⃣: Return combined result
        res.json({
            success: true,
            data: {
                summary: {
                    total_jobs: parseInt(summaryRes.rows[0].total_jobs),
                    total_earnings: parseFloat(summaryRes.rows[0].total_earnings),
                },
                rides: ridesRes.rows,
            }
        });
    } catch (err) {
        console.error('❌ Error fetching driver history:', err.message);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
};

exports.getMakes = async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name FROM vehicle_makes ORDER BY name ASC`);
    res.json({ status: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};

exports.getModelsByMake = async (req, res) => {
  try {
    const { make_id } = req.params;

    const query = `
      SELECT id, name 
      FROM vehicle_models 
      WHERE make_id = $1
      ORDER BY name ASC
    `;

    const result = await pool.query(query, [make_id]);

    res.json({ status: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
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

exports.getVehicleTypes = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM cab_types ORDER BY name ASC`);
    res.json({ status: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};
