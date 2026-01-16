
const pool = require('../dbconfig');
const { sendNotification, sendNotificationToUser, sendNotificationToDriver } = require('../hooks/notification');
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;
const { getIO } = require("../sockets/index");
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
        // 🔹 Step 1: Fetch user basic details
        const userQuery = `
      SELECT 
        id,
        full_name,
        email,
        phone_number,
        role,
        is_verified,
        profile_image,
        date_of_birth,
        address,
        gender,
        stripe_account_status,
        created_at,
        updated_at
      FROM users
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1;
    `;
        const userResult = await pool.query(userQuery, [user_id]);

        if (userResult.rowCount === 0) {
            return res.status(404).json({
                status: false,
                message: 'User not found'
            });
        }

        const user = userResult.rows[0];

        const userData = {
            ...user,
            profile_image_url: user.profile_image
                ? `${BASE_IMAGE_URL}/${user.profile_image}`
                : null,
            stripe_account_status:
                user.stripe_account_status === '3'
                    ? 'Active'
                    : user.stripe_account_status === '2'
                        ? 'Under Review'
                        : 'Pending'
        };

        // 🔹 Step 2: Fetch driver profile ONLY for Cab Owner
        if (user.role === 'Cab Owner') {
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

            if (driverResult.rowCount > 0) {
                const driver = driverResult.rows[0];

                // 🔹 Step 3: Disability features
                const featuresQuery = `
          SELECT df.id, df.name
          FROM driver_disability_features ddf
          JOIN disability_features df ON ddf.disability_feature_id = df.id
          WHERE ddf.driver_id = $1;
        `;
                const featuresResult = await pool.query(featuresQuery, [driver.id]);

                driver.disability_features = featuresResult.rows;

                // 🔹 Step 4: Attach image URLs
                const fileFields = [
                    'license_photo_front',
                    'license_photo_back',
                    'rc_copy',
                    'insurance_copy',
                    'police_check_certificate',
                    'wwvp_card'
                ];

                fileFields.forEach(field => {
                    if (driver[field]) {
                        const cleanPath = driver[field].replace(/^\/+/, '');
                        driver[field] = `${BASE_IMAGE_URL}/${cleanPath}`;
                    }
                });

                userData.driver_details = driver;
            } else {
                userData.driver_details = null;
            }
        }

        // 🔹 Step 5: Send response
        return res.json({
            status: true,
            data: {
                user: userData
            }
        });

    } catch (err) {
        console.error('❌ Error fetching profile:', err.message);
        return res.status(500).json({
            status: false,
            message: 'Internal server error'
        });
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
            disability_features,
            full_name,
            email,
            phone_number,
            address,
            date_of_birth
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

        // 🔹 6️⃣ Update users table
        await client.query(
            `
            UPDATE users SET
                full_name = COALESCE($1, full_name),
                email = COALESCE($2, email),
                phone_number = COALESCE($3, phone_number),
                address = COALESCE($4, address),
                date_of_birth = COALESCE($5, date_of_birth),
                updated_at = NOW()
            WHERE id = $6
            `,
            [full_name, email, phone_number, address, date_of_birth, user_id]
        );

        await client.query('COMMIT');

        res.status(200).json({
            status: true,
            message: 'Driver profile and user details updated successfully'
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error updating profile:', err.message);
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

exports.getBookingDetails = async (req, res) => {
  const user_id = req.user?.userId;
  const { bookingId } = req.params;

  if (!user_id) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized",
    });
  }

  const client = await pool.connect();

  try {
    const bookingQuery = `
      SELECT
        b.id,
        b.booking_type,
        b.booking_mode,
        b.pickup_address,
        b.drop_address,
        b.pickup_lat,
        b.pickup_lng,
        b.drop_lat,
        b.drop_lng,
        b.scheduled_time,
        b.distance_km,
        b.estimated_fare,
        b.payment_status,
        b.booking_otp,
        b.booking_verified,
        b.status,
        b.created_at,

        -- Passenger
        u.id AS passenger_id,
        u.full_name AS passenger_name,
        u.phone_number AS passenger_phone,

        -- ✅ Full Image URL
        CASE 
          WHEN u.profile_image IS NULL OR u.profile_image = '' THEN NULL
          ELSE CONCAT($2::text, u.profile_image)
        END AS passenger_image_url,

        -- Cab Type
        ct.name AS cab_type_name

      FROM cab_bookings b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN cab_types ct ON b.cab_type_id = ct.id
      WHERE b.id = $1
      LIMIT 1
    `;

    const image_url = `${BASE_IMAGE_URL}/`;
    const bookingRes = await client.query(bookingQuery, [
      bookingId,
      image_url, // example: "https://yourdomain.com/"
    ]);

    if (!bookingRes.rowCount) {
      return res.status(404).json({
        status: false,
        message: "Booking not found",
      });
    }

    res.status(200).json({
      status: true,
      data: bookingRes.rows[0],
    });
  } catch (err) {
    console.error("❌ Error fetching booking details:", err.message);
    res.status(500).json({
      status: false,
      message: "Server error while fetching booking details",
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


exports.getDashboard = async (req, res) => {
    const user_id = req.user.userId;

    try {
        // 🔹 Get driver
        const driverRes = await pool.query(
            `SELECT id FROM drivers WHERE user_id = $1 LIMIT 1`,
            [user_id]
        );

        if (!driverRes.rowCount) {
            return res.status(404).json({
                status: false,
                message: "Driver not found"
            });
        }

        const driver_id = driverRes.rows[0].id;

        // 🔹 Parallel overall queries
        const [jobs, distance, earnings, hours] = await Promise.all([

            // Total completed jobs
            pool.query(`
        SELECT COUNT(*) 
        FROM cab_bookings
        WHERE driver_id = $1
          AND status = 'completed'
      `, [driver_id]),

            // Total distance
            pool.query(`
        SELECT COALESCE(SUM(distance_km), 0) 
        FROM cab_bookings
        WHERE driver_id = $1
          AND status = 'completed'
      `, [driver_id]),

            // Total earnings
            pool.query(`
        SELECT COALESCE(SUM(estimated_fare), 0)
        FROM cab_bookings
        WHERE driver_id = $1
          AND status = 'completed'
      `, [driver_id]),

            // Total hours online (overall)
            pool.query(`
        WITH logs AS (
          SELECT 
            created_at,
            status,
            LEAD(created_at) OVER (ORDER BY created_at) AS next_time
          FROM driver_status_logs
          WHERE driver_id = $1
        )
        SELECT ROUND(
          COALESCE(
            SUM(
              EXTRACT(EPOCH FROM (COALESCE(next_time, NOW()) - created_at))
            ) / 3600,
            0
          ),
          2
        ) AS hours_online
        FROM logs
        WHERE status = 'online'
      `, [driver_id])
        ]);

        res.json({
            status: true,
            data: {
                total_jobs: Number(jobs.rows[0].count),
                total_distance: Number(distance.rows[0].coalesce),
                total_earned: Number(earnings.rows[0].coalesce),
                hours_online: Number(hours.rows[0].hours_online || 0)
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            status: false,
            message: "Server error"
        });
    }
};

exports.submitUserRating = async (req, res) => {

    const { driver_id, user_id, rating, description } = req.body;

    if (!user_id || !rating) {
        return res.status(400).json({
            status: false,
            message: "User ID and rating are required",
        });
    }

    if (rating < 1 || rating > 5) {
        return res.status(400).json({
            status: false,
            message: "Rating must be between 1 and 5",
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1️⃣ Ensure user exists
        const userRes = await client.query(
            "SELECT id FROM users WHERE id = $1",
            [user_id]
        );

        if (!userRes.rows.length) {
            throw new Error("User not found");
        }

        // 2️⃣ Insert review ✅
        const reviewRes = await client.query(
            `
      INSERT INTO driver_reviews (driver_id, user_id, rating, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
      `,
            [driver_id, user_id, rating, description || null]
        );

        await client.query("COMMIT");

        res.status(201).json({
            status: true,
            message: "User rated successfully",
            data: reviewRes.rows[0],
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ user rating error:", err.message);

        res.status(400).json({
            status: false,
            message: err.message,
        });
    } finally {
        client.release();
    }
};

exports.assignScheduledBookings = async (req, res) => {
    const minutesBefore =
        req.body && req.body.minutes_before
            ? Number(req.body.minutes_before)
            : 15;

    const client = await pool.connect();

    try {
        const bookingsRes = await client.query(`
      SELECT *
      FROM cab_bookings
      WHERE status = 'scheduled'
        AND driver_id IS NULL
        AND scheduled_time <= NOW() + ($1 * INTERVAL '1 minute')
        AND scheduled_time > NOW()
    `, [minutesBefore]);

        let broadcasted = 0;

        for (const booking of bookingsRes.rows) {
            const sent = await broadcastScheduledBooking(booking);
            if (sent) broadcasted++;
        }

        res.json({
            processed: bookingsRes.rowCount,
            assigned_for_broadcast: broadcasted
        });

    } catch (err) {
        console.error("❌ assignScheduledBookings error:", err);
        res.status(500).json({ message: "Server error" });
    } finally {
        client.release();
    }
};

async function broadcastScheduledBooking(booking) {

  // 🔁 Radius per attempt
  const radiusByAttempt = [5, 8, 12];
  const radius = radiusByAttempt[booking.assign_attempts] || 15;

  // ✅ 0️⃣ Get Passenger Details (ONLY ONCE)
  const userRes = await pool.query(
    `
      SELECT 
        id,
        full_name,
        phone_number,
        profile_image
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [booking.user_id]
  );

  const passenger = userRes.rows[0]
    ? {
        passenger_id: userRes.rows[0].id,
        passenger_name: userRes.rows[0].full_name,
        passenger_phone: userRes.rows[0].phone_number,
        passenger_image_url: userRes.rows[0].profile_image
          ? `${BASE_IMAGE_URL}/${userRes.rows[0].profile_image}`
          : null,
      }
    : null;

  // 1️⃣ Find nearby drivers
  const drivers = await pool.query(
    `
      SELECT t.id, t.user_id
      FROM (
          SELECT 
              d.id,
              d.user_id,
              (
                  6371 * acos(
                      cos(radians($1)) * cos(radians(d.current_lat)) *
                      cos(radians(d.current_lng) - radians($2)) +
                      sin(radians($1)) * sin(radians(d.current_lat))
                  )
              ) AS distance
          FROM drivers d
          WHERE d.is_available = true
          AND d.status = 'online'
          AND d.cab_type_id = $3
          AND d.current_lat IS NOT NULL
          AND d.current_lng IS NOT NULL
          AND (
              $4::INT IS NULL OR EXISTS (
                SELECT 1
                FROM driver_disability_features ddf
                WHERE ddf.driver_id = d.id
                  AND ddf.disability_feature_id = $4
              )
          )
      ) t
      WHERE t.distance <= $5
      ORDER BY t.distance ASC
      LIMIT 20
    `,
    [
      booking.pickup_lat,
      booking.pickup_lng,
      booking.cab_type_id,
      booking.disability_features_id,
      radius,
    ]
  );

  if (!drivers.rowCount) {
    await pool.query(
      `
        UPDATE cab_bookings
        SET assign_attempts = assign_attempts + 1
        WHERE id = $1
      `,
      [booking.id]
    );
    return false;
  }

  const driverIds = new Set();

  for (const driver of drivers.rows) {
    driverIds.add(driver.id);

    await sendNotificationToDriver({
      driverUserId: driver.user_id,
      title: "Scheduled Ride Available",
      message: `Pickup at ${booking.pickup_address}`,
      type: "Booking",
      booking_id: String(booking.id),
      image_url: `${BASE_IMAGE_URL}/icons/check-xmark.png`,
      bg_color: "#DF1D17",
      data: {
        screen: "BookingDetails",
        sound: "default",
      },
    });

    const io = getIO();

    // ✅ Send booking + passenger details
    io.to(`driver:${driver.id}`).emit("booking:new", {
      ...booking,
      is_scheduled: true,
      passenger, // ✅ here
    });
  }

  return true;
}

exports.cancelExpiredBookings = async (req, res) => {
    const client = await pool.connect();

    try {
        const { rows } = await client.query(`
      UPDATE cab_bookings
      SET status = 'cancelled'      
      WHERE driver_id IS NULL
        AND status IN ('scheduled', 'pending')
        AND scheduled_time < NOW()
      RETURNING id, user_id
    `);

        return res.json({
            success: true,
            cancelled_count: rows.length,
            cancelled_bookings: rows.map(b => b.id)
        });

    } catch (err) {
        console.error("❌ cancelExpiredBookings error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    } finally {
        client.release();
    }
};


exports.getLetestBooking = async (req, res) => {
    const user_id = req.user?.userId;

    if (!user_id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
    }

    const client = await pool.connect();

    try {
        // ✅ Get driver_id
        const driverResult = await client.query(
            "SELECT id FROM drivers WHERE user_id = $1 LIMIT 1",
            [user_id]
        );

        if (driverResult.rowCount === 0) {
            return res.status(404).json({
                status: false,
                message: "Driver not found. Please register your profile first.",
            });
        }

        const driverId = driverResult.rows[0].id;

        // ✅ Latest booking only
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
      WHERE b.driver_id = $1
      ORDER BY b.created_at DESC
      LIMIT 1;
    `;

        const bookingResult = await client.query(query, [driverId]);

        // ✅ If no booking found
        if (bookingResult.rowCount === 0) {
            return res.status(200).json({
                status: true,
                message: "No pending bookings found",
                data: null,
            });
        }

        // ✅ Return single object
        return res.status(200).json({
            status: true,
            data: bookingResult.rows[0],
        });
    } catch (err) {
        console.error("❌ Error fetching driver booking:", err.message);
        return res.status(500).json({
            status: false,
            message: "Server error while fetching booking",
            error: err.message,
        });
    } finally {
        client.release();
    }
};