const pool = require("../../dbconfig");
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;
const stripe = require("../../stripe");
const { sendNotificationToDriver } = require("../../hooks/notification");
const { bookingTimers,bookingDriversMap } = require("../bookingTimers");
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
    if (!bookingId) {
      return socket.emit("cancelRideByUser:error", {
        message: "Booking ID required",
      });
    }

    const bookingRes = await pool.query(
      `SELECT status, payment_intent_id, estimated_fare, driver_id
       FROM cab_bookings
       WHERE id=$1`,
      [bookingId]
    );

    if (!bookingRes.rows.length) throw new Error("Booking not found");

    const { status, payment_intent_id, estimated_fare, driver_id } =
      bookingRes.rows[0];

    /* ✅ CASE 1: SEARCHING (no driver assigned) */
    if (status === "searching") {
      await pool.query(
        `UPDATE cab_bookings
         SET status='cancelled', updated_at=NOW()
         WHERE id=$1`,
        [bookingId]
      );

      const timeoutId = bookingTimers.get(bookingId);
      if (timeoutId) {
        clearTimeout(timeoutId);
        bookingTimers.delete(bookingId);
      }

      const driverIds = bookingDriversMap.get(bookingId) || [];

      for (const dId of driverIds) {
        io.to(`driver:${dId}`).emit("booking:cancelledByUser", {
          bookingId,
          message: "User cancelled ride",
        });
      }

      bookingDriversMap.delete(bookingId);

      return socket.emit("cancelRideByUser:success", {
        bookingId,
        payment_status: "no_charge",
        message: "Ride cancelled. No penalty charged.",
      });
    }

    /* ✅ CASE 2: PENDING (accepted but not started?) */
    if (status === "pending") {
      await pool.query(
        `UPDATE cab_bookings
         SET status='cancelled',
             payment_status='refunded',
             updated_at=NOW()
         WHERE id=$1`,
        [bookingId]
      );

      // notify assigned driver (if any)
      if (driver_id) {
        io.to(`driver:${driver_id}`).emit("booking:cancelledByUser", {
          bookingId,
          message: "User cancelled ride",
        });
      }

      return socket.emit("cancelRideByUser:success", {
        bookingId,
        payment_status: "no_charge",
        message: "Ride cancelled before start. No charge taken.",
      });
    }

    /* ✅ CASE 3: AFTER ACCEPT / STARTED => penalty */
    const rule = await pool.query(
      `SELECT deduction_percentage, minimum_deduction_amount
       FROM cancellation_rules
       WHERE active = TRUE
       ORDER BY id DESC LIMIT 1`
    );

    const { deduction_percentage, minimum_deduction_amount } = rule.rows[0];

    let penalty = (estimated_fare * deduction_percentage) / 100;
    if (penalty < minimum_deduction_amount) penalty = minimum_deduction_amount;

    const penaltyCents = Math.round(penalty * 100);

    if (!payment_intent_id) {
      throw new Error("Payment intent missing, cannot charge penalty!");
    }

    const captured = await stripe.paymentIntents.capture(payment_intent_id, {
      amount_to_capture: penaltyCents,
    });

    await pool.query(
      `UPDATE cab_bookings
       SET status='cancelled',
           payment_status='cancelled',
           updated_at=NOW()
       WHERE id=$1`,
      [bookingId]
    );

    // notify driver (if assigned)
    if (driver_id) {
      // io.to(`driver:${driver_id}`).emit("rideCancelledByUser", {
      //   bookingId,
      //   penalty,
      // });
       io.to(`driver:${driver_id}`).emit("booking:cancelledByUser", {
          bookingId,
          penalty,
          message: "User cancelled ride",
        });
    }

    return socket.emit("cancelRideByUser:success", {
      bookingId,
      penaltyAmount: penalty,
      payment_status: captured.status,
      message: "Ride cancelled. Penalty charged.",
    });
  } catch (err) {
    socket.emit("cancelRideByUser:error", {
      message: err.message,
    });
  }
});

};
