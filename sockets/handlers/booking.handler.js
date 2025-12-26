const pool = require("../../dbconfig");
const { sendNotificationToDriver } = require("../../hooks/notification");
module.exports = (io, socket) => {

  socket.on("booking:track", async ({ bookingId }) => {
    try {
      socket.join(`booking:${bookingId}`);

      const result = await pool.query(
        `
        SELECT
          b.id AS booking_id,
          b.status,
          b.otp,

          d.id AS driver_id,
          d.name AS driver_name,
          d.profile_image,
          d.vehicle_number,
          d.current_lat,
          d.current_lng,

          u.phone_number AS driver_phone,

          c.name AS cab_type,
          c.thumbnail_url AS cab_image,

          -- ⭐ Average driver rating
          COALESCE(
            (
              SELECT ROUND(AVG(r.rating)::numeric, 1)
              FROM driver_reviews r
              WHERE r.driver_id = d.id
            ),
            5.0
          ) AS driver_rating

        FROM cab_bookings b
        LEFT JOIN drivers d ON d.id = b.driver_id
        LEFT JOIN users u ON u.id = d.user_id
        LEFT JOIN cab_types c ON c.id = d.cab_type_id
        WHERE b.id = $1
        `,
        [bookingId]
      );

      if (!result.rows.length) {
        return socket.emit("booking:initDetails:error", {
          message: "Booking not found",
        });
      }

      const row = result.rows[0];

      socket.emit("booking:initDetails", {
        booking: {
          id: row.booking_id,
          status: row.status,
          otp: row.otp,
        },
        driver: {
          id: row.driver_id,
          name: row.driver_name,
          phone_number: row.driver_phone,
          profile_image: row.profile_image,
          rating: row.driver_rating, // ⭐ REAL AVERAGE
          vehicle_number: row.vehicle_number,
          cab_type: row.cab_type,
          cab_image: row.cab_image,
          location: {
            lat: row.current_lat,
            lng: row.current_lng,
          },
        },
      });

    } catch (err) {
      console.error("❌ booking:initDetails error:", err.message);
      socket.emit("booking:initDetails:error", {
        message: "Failed to load ride details",
      });
    }
  });

    // socket.on('cab:book', async (payload, callback) => {
    //   const client = await pool.connect();

    //   try {
    //     await client.query('BEGIN');

    //     const user_id = socket.user.userId;

    //     const {
    //       cab_type_id,
    //       booking_type,
    //       booking_mode,
    //       pickup_address,
    //       pickup_lat,
    //       pickup_lng,
    //       drop_address,
    //       drop_lat,
    //       drop_lng,
    //       disability_features_id = null, // ✅ OPTIONAL
    //       scheduled_time
    //     } = payload;

    //     // ✅ Basic validation
    //     if (
    //       !cab_type_id || !booking_type ||
    //       !pickup_address || !pickup_lat || !pickup_lng ||
    //       !drop_address || !drop_lat || !drop_lng
    //     ) {
    //       throw 'MISSING_FIELDS';
    //     }

    //     // ✅ Cab check
    //     const cabRes = await client.query(
    //       'SELECT * FROM cab_types WHERE id = $1',
    //       [cab_type_id]
    //     );
    //     if (!cabRes.rowCount) throw 'CAB_NOT_FOUND';

    //     const cabType = cabRes.rows[0];

    //     // ✅ Distance calculation
    //     const rad = Math.PI / 180;
    //     const R = 6371;

    //     const dLat = (drop_lat - pickup_lat) * rad;
    //     const dLng = (drop_lng - pickup_lng) * rad;

    //     const a =
    //       Math.sin(dLat / 2) ** 2 +
    //       Math.cos(pickup_lat * rad) *
    //       Math.cos(drop_lat * rad) *
    //       Math.sin(dLng / 2) ** 2;

    //     const distance_km = +(R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))).toFixed(2);
    //     const estimated_fare = +(
    //       (cabType.base_fare || 0) +
    //       distance_km * cabType.standard_price
    //     ).toFixed(2);

    //     let driverId = null;

    //     // 🔐 DRIVER ASSIGNMENT (DISABILITY-AWARE)
    //     if (booking_type === 'instant') {

    //       const driverQuery = `
    //       SELECT d.id
    //       FROM drivers d
    //       WHERE d.is_available = true
    //         AND d.status = 'online'
    //         AND d.cab_type_id = $1
    //         AND (
    //           $2::INT IS NULL OR EXISTS (
    //             SELECT 1
    //             FROM driver_disability_features ddf
    //             WHERE ddf.driver_id = d.id
    //               AND ddf.disability_feature_id = $2
    //           )
    //         )
    //       ORDER BY (
    //         6371 * acos(
    //           cos(radians($3)) * cos(radians(d.current_lat)) *
    //           cos(radians(d.current_lng) - radians($4)) +
    //           sin(radians($3)) * sin(radians(d.current_lat))
    //         )
    //       ) ASC
    //       LIMIT 1
    //       FOR UPDATE
    //     `;

    //       const params = [
    //         cab_type_id,                    // $1
    //         disability_features_id,         // $2 (NULL allowed)
    //         pickup_lat,                     // $3
    //         pickup_lng                      // $4
    //       ];

    //       const driverRes = await client.query(driverQuery, params);

    //       if (!driverRes.rowCount) throw 'NO_DRIVER_AVAILABLE';

    //       driverId = driverRes.rows[0].id;
    //       console.log(driverRes.rows[0]);

    //       await client.query(
    //         'UPDATE drivers SET is_available = false WHERE id = $1',
    //         [driverId]
    //       );
    //     }

    //     // ✅ Create booking
    //     const bookingRes = await client.query(`
    //     INSERT INTO cab_bookings (
    //       user_id, driver_id, cab_type_id, booking_type,
    //       pickup_address, pickup_lat, pickup_lng,
    //       drop_address, drop_lat, drop_lng,
    //       scheduled_time, distance_km, estimated_fare,
    //       status, booking_mode, disability_features_id
    //     )
    //     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    //     RETURNING *
    //   `, [
    //       user_id,
    //       driverId,
    //       cab_type_id,
    //       booking_type,
    //       pickup_address,
    //       pickup_lat,
    //       pickup_lng,
    //       drop_address,
    //       drop_lat,
    //       drop_lng,
    //       scheduled_time || null,
    //       distance_km,
    //       estimated_fare,
    //       booking_type === 'instant' ? 'pending' : 'scheduled',
    //       booking_mode,
    //       disability_features_id
    //     ]);

    //     await client.query('COMMIT');

    //     const booking = bookingRes.rows[0];

    //     // 🔔 Notify driver
    //     if (driverId) {
    //       io.to(`driver:${driverId}`).emit('booking:new', booking);
    //     }

    //     // 🔔 Confirm user
    //     socket.emit('booking:confirmed', booking);

    //     callback({ status: true, data: booking });

    //   } catch (err) {
    //     await client.query('ROLLBACK');

    //     const messages = {
    //       MISSING_FIELDS: 'Missing required fields',
    //       NO_DRIVER_AVAILABLE: 'No suitable driver available',
    //       CAB_NOT_FOUND: 'Cab type not found'
    //     };

    //     callback({
    //       status: false,
    //       message: messages[err] || 'Server error'
    //     });

    //   } finally {
    //     client.release();
    //   }
    // });


  socket.on('cab:book', async (payload, callback) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const user_id = socket.user.userId;

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
        disability_features_id = null,
        scheduled_time
      } = payload;

      // ===============================
      // BASIC VALIDATION
      // ===============================
      if (
        !cab_type_id || !booking_type ||
        !pickup_address || !pickup_lat || !pickup_lng ||
        !drop_address || !drop_lat || !drop_lng
      ) {
        throw 'MISSING_FIELDS';
      }

      // ===============================
      // CAB TYPE CHECK
      // ===============================
      const cabRes = await client.query(
        'SELECT * FROM cab_types WHERE id = $1',
        [cab_type_id]
      );
      if (!cabRes.rowCount) throw 'CAB_NOT_FOUND';

      const cabType = cabRes.rows[0];

      // ===============================
      // DISTANCE & FARE CALCULATION
      // ===============================
      const rad = Math.PI / 180;
      const R = 6371;

      const dLat = (drop_lat - pickup_lat) * rad;
      const dLng = (drop_lng - pickup_lng) * rad;

      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(pickup_lat * rad) *
        Math.cos(drop_lat * rad) *
        Math.sin(dLng / 2) ** 2;

      const distance_km = +(
        R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
      ).toFixed(2);

      const estimated_fare = +(
        (cabType.base_fare || 0) +
        distance_km * cabType.standard_price
      ).toFixed(2);

      // ===============================
      // FIND ALL DRIVERS WITHIN 5 KM
      // ===============================
      let drivers = [];

      if (booking_type === 'instant') {
      const driverQuery = `
          SELECT *
          FROM (
            SELECT d.id,
              (
                6371 * acos(
                  cos(radians($3)) * cos(radians(d.current_lat)) *
                  cos(radians(d.current_lng) - radians($4)) +
                  sin(radians($3)) * sin(radians(d.current_lat))
                )
              ) AS distance
            FROM drivers d
            WHERE d.is_available = true
              AND d.status = 'online'
              AND d.cab_type_id = $1
              AND d.current_lat IS NOT NULL
              AND d.current_lng IS NOT NULL
              AND (
                $2::INT IS NULL OR EXISTS (
                  SELECT 1
                  FROM driver_disability_features ddf
                  WHERE ddf.driver_id = d.id
                    AND ddf.disability_feature_id = $2
                )
              )
          ) t
          WHERE t.distance <= 5
        `;

        const driverRes = await client.query(driverQuery, [
          cab_type_id,
          disability_features_id,
          pickup_lat,
          pickup_lng
        ]);

        if (!driverRes.rowCount) throw 'NO_DRIVER_AVAILABLE';

        drivers = driverRes.rows;
      }

      // ===============================
      // CREATE BOOKING (NO DRIVER YET)
      // ===============================
      const bookingRes = await client.query(`
      INSERT INTO cab_bookings (
        user_id, cab_type_id, booking_type,
        pickup_address, pickup_lat, pickup_lng,
        drop_address, drop_lat, drop_lng,
        scheduled_time, distance_km, estimated_fare,
        status, booking_mode, disability_features_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
        user_id,
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
        booking_type === 'instant' ? 'searching' : 'scheduled',
        booking_mode,
        disability_features_id
      ]);

      await client.query('COMMIT');

      const booking = bookingRes.rows[0];

      // ===============================
      // BROADCAST TO ALL DRIVERS
      // ===============================
      if (booking_type === 'instant') {
        for (const driver of drivers) {
          io.to(`driver:${driver.id}`).emit('booking:new', booking);
        }
      }

      socket.emit('booking:confirmed', booking);
      callback({ status: true, data: booking });

    } catch (err) {
       console.error("❌ CAB BOOK ERROR:", err);
      await client.query('ROLLBACK');

      const messages = {
        MISSING_FIELDS: 'Missing required fields',
        NO_DRIVER_AVAILABLE: 'No driver available nearby',
        CAB_NOT_FOUND: 'Cab type not found'
      };

      callback({
        status: false,
        message: messages[err] || 'Server error'
      });
    } finally {
      client.release();
    }
  });
};
