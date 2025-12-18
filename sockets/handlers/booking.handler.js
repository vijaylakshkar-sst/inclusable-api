const pool = require("../../dbconfig");

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

};
