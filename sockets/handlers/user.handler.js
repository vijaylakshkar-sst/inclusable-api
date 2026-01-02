const pool = require("../../dbconfig");
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;
const stripe = require("../../stripe");
const { sendNotificationToDriver } = require("../../hooks/notification");

module.exports = (io, socket) => {

  socket.on("user:cab-find", async ({ lat, lng, radius_km = 10 }) => {
    try {
      // validation
      if (!lat || !lng) {
        return socket.emit("cab:find:result", {
          status: false,
          message: "Latitude and longitude are required",
          data: []
        });
      }

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

      const { rows } = await pool.query(query, [
        lat,
        lng,
        radius_km
      ]);

      if (rows.length === 0) {
        return socket.emit("cab:find:result", {
          status: false,
          message: "No rides found near your location",
          data: []
        });
      }

      socket.emit("cab:find:result", {
        status: true,
        message: "Rides found successfully",
        data: rows
      });

    } catch (error) {
      console.error("❌ CAB FIND SOCKET ERROR:", error.message);

      socket.emit("cab:find:result", {
        status: false,
        message: "Server error",
        data: []
      });
    }
  });

  socket.on("cancelRideByUser", async ({ bookingId }) => {
    try {
      const userId = socket.user?.userId;

      if (!bookingId) {
        return socket.emit("cancelRideByUser:error", {
          message: "Booking ID required",
        });
      }

      // get booking + payment intent
      const bookingRes = await pool.query(
        `SELECT status, payment_intent_id, estimated_fare
       FROM cab_bookings
       WHERE id=$1`,
        [bookingId]
      );

      if (!bookingRes.rows.length) {
        throw new Error("Booking not found");
      }

      const { status, payment_intent_id, estimated_fare } = bookingRes.rows[0];

      // cancellation rules
      if (status === "pending") {
        // no hold exists yet, so no charge
        await pool.query(
          `UPDATE cab_bookings
         SET status='cancelled',
             payment_status='refunded',
             updated_at=NOW()
         WHERE id=$1`,
          [bookingId]
        );

        return socket.emit("cancelRideByUser:success", {
          bookingId,
          payment_status: "no_charge",
          message: "Ride cancelled before accept. No charge taken."
        });
      }

      // cancellation AFTER accept => apply penalty 5%
      // fetch active rule
      const rule = await pool.query(
        `SELECT deduction_percentage, minimum_deduction_amount
        FROM cancellation_rules
        WHERE active = TRUE
        ORDER BY id DESC LIMIT 1`
      );

      const { deduction_percentage, minimum_deduction_amount } = rule.rows[0];

      // calculate
      let penalty = (estimated_fare * deduction_percentage / 100);

      if (penalty < minimum_deduction_amount) {
        penalty = minimum_deduction_amount;
      }

      // convert to cents for stripe
      const penaltyCents = Math.round(penalty * 100);

      if (!payment_intent_id) {
        throw new Error("Payment intent missing, cannot charge penalty!");
      }

      // capture only penalty amount
      const captured = await stripe.paymentIntents.capture(payment_intent_id, {
        amount_to_capture: penaltyCents
      });

      // update DB
      const bookingData = await pool.query(
        `UPDATE cab_bookings
       SET status='cancelled',
           payment_status='partial_paid',
           updated_at=NOW()
       WHERE id=$1
       RETURNING id, user_id, driver_id, status, payment_status, created_at, updated_at, deleted_at`,
        [bookingId]
      );


      const booking = bookingData.rows[0];
      const driverId = booking.driver_id;

      const driverResult = await pool.query(
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
      
      // update driver status is_available-true
      const cabDriverUpdate = await pool.query(
        "UPDATE drivers SET is_available = true WHERE id = $1",
        [driverId]
      );
      
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


      socket.emit("cancelRideByUser:success", {
        bookingId,
        penaltyAmount: penalty / 100,
        payment_status: captured.status,
        message: "Ride cancelled. 5% penalty charged."
      });

      io.to(`booking:${bookingId}`).emit("rideCancelledByUser", {
        bookingId,
        penalty: penalty / 100
      });

    } catch (err) {
      socket.emit("cancelRideByUser:error", {
        message: err.message,
      });
    }
  });

};
