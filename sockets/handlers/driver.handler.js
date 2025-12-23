const pool = require("../../dbconfig");
const store = require("../socketStore");

module.exports = (io, socket) => {

  // ================================
  // DRIVER ONLINE
  // ================================
  socket.on("driver:online", async ({ driverId }) => {
    try {
      store.addDriver(driverId, socket.id);

      const result = await pool.query(
        `SELECT id, user_id, cab_type_id, vehicle_number,
                current_lat, current_lng, is_available, status
         FROM drivers WHERE id = $1`,
        [driverId]
      );

      const driver = result.rows[0];

      socket.emit("driver:profile", driver);
      io.emit("driver:online", driver);
    } catch (err) {
      console.error("❌ driver:online error:", err.message);
    }
  });

  // ================================
  // DRIVER LOCATION UPDATE
  // ================================
  socket.on("driver:location:update", async ({ bookingId, lat, lng }) => {
    try {
      // 🔒 Verify booking + driver
      const bookingRes = await pool.query(
        `SELECT driver_id, status
       FROM cab_bookings
       WHERE id = $1`,
        [bookingId]
      );

      if (!bookingRes.rows.length) return;

      if (!["accepted", "in_progress"].includes(bookingRes.rows[0].status)) {
        return;
      }

      const driverId = bookingRes.rows[0].driver_id;

      // ✅ Update driver location
      await pool.query(
        `UPDATE drivers
       SET current_lat = $1,
           current_lng = $2,
           updated_at = NOW()
       WHERE id = $3`,
        [lat, lng, driverId]
      );

      // 📡 Emit location ONLY to booking room
      io.to(`booking:${bookingId}`).emit("booking:driverLocation", {
        lat,
        lng,
      });

    } catch (err) {
      console.error("❌ driver:location:update error:", err.message);
    }
  });

  // ===============================
  // ➕ NEW: UPDATE DRIVER STATUS
  // ===============================
  socket.on("updateStatus", async ({ status }) => {
    const userId = socket.user?.userId;

    if (!["online", "offline"].includes(status)) {
      return socket.emit("updateStatus:error", {
        message: "Invalid status"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 🔹 Get driver
      const driverRes = await client.query(
        "SELECT id, status FROM drivers WHERE user_id = $1 LIMIT 1",
        [userId]
      );

      if (!driverRes.rows.length) {
        throw new Error("Driver not found");
      }

      const { id: driverId, status: currentStatus } = driverRes.rows[0];

      // 🔴 Prevent duplicate logs (online → online)
      if (currentStatus === status) {
        await client.query("ROLLBACK");
        return socket.emit("updateStatus:error", {
          message: `Driver already ${status}`
        });
      }

      // 🔹 Update driver status
      await client.query(
        `UPDATE drivers 
       SET status = $1, updated_at = NOW() 
       WHERE id = $2`,
        [status, driverId]
      );

      // 🔹 Insert status log
      await client.query(
        `INSERT INTO driver_status_logs (driver_id, status)
       VALUES ($1, $2)`,
        [driverId, status]
      );

      await client.query("COMMIT");

      // 🔹 Broadcast update
      io.emit("statusUpdated", { driverId, status });

    } catch (err) {
      await client.query("ROLLBACK");
      socket.emit("updateStatus:error", {
        message: err.message
      });
    } finally {
      client.release();
    }
  });

  // ======================================
  // 🚖 DRIVER RIDE ACTION (ACCEPT / IGNORE / CANCEL)
  // ======================================
  socket.on("rideAction", async ({ bookingId, action }) => {
    const userId = socket.user?.userId;

    if (!bookingId || !["accept", "ignore", "cancel"].includes(action)) {
      return socket.emit("rideAction:error", {
        message: "Invalid ride action",
      });
    }

    try {
      // ✅ Get driver
      const driverRes = await pool.query(
        "SELECT id FROM drivers WHERE user_id = $1 LIMIT 1",
        [userId]
      );

      if (!driverRes.rows.length) {
        throw new Error("Driver not found");
      }

      const driverId = driverRes.rows[0].id;

      // 🔒 Lock booking row
      const bookingRes = await pool.query(
        `SELECT status
       FROM cab_bookings
       WHERE id = $1
       FOR UPDATE`,
        [bookingId]
      );

      if (!bookingRes.rows.length) {
        throw new Error("Booking not found");
      }

      const currentStatus = bookingRes.rows[0].status;

      // ======================
      // ✅ ACCEPT BOOKING
      // ======================
      if (action === "accept") {
        if (currentStatus !== "pending") {
          throw new Error("Booking not available for acceptance");
        }

        // 🔻 fetch booking details
        const bookingDetail = await pool.query(
          `SELECT user_id, estimated_fare FROM cab_bookings WHERE id=$1`,
          [bookingId]
        );

        const { user_id, estimated_fare } = bookingDetail.rows[0];

        // 🔻 fetch payment method from DB
        const pmRes = await pool.query(
          `SELECT payment_method_id, customer_id 
            FROM stripe_payment_methods 
            WHERE user_id=$1 LIMIT 1`,
          [user_id]
        );

        if (!pmRes.rows.length) {
          throw new Error("Customer has no saved payment method");
        }

        const paymentMethodId = pmRes.rows[0].payment_method_id;
        const stripeCustomerId = pmRes.rows[0].customer_id;

        // 🔻 Block payment using Stripe
        const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(estimated_fare * 100), // example 25.99 AUD -> 2599 cents
        currency: "aud",                         // 👈 AUD here
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        confirm: true,
        capture_method: "manual",   // hold only
        description: `Ride booking hold for booking: ${bookingId}`,
        metadata: {
          bookingId,
          customer_id,
          driverId
        }
      });

        // 🔻 store paymentIntentId in bookings table
        await pool.query(
          `UPDATE cab_bookings
            SET driver_id=$1,
                payment_intent_id=$2,
                status='accepted',
                updated_at=NOW()
            WHERE id=$3`,
          [driverId, paymentIntent.id, bookingId]
        );

        socket.emit("rideAction:success", {
          bookingId,
          action: "accepted",
          payment_intent_id: paymentIntent.id,
          payment_status: paymentIntent.status   // should be requires_capture
        });

        io.to(`booking:${bookingId}`).emit("booking:accepted", {
          bookingId,
          driverId,
        });

      }

      // ======================
      // ❌ IGNORE BOOKING
      // ======================
      if (action === "ignore") {
        if (currentStatus !== "pending") {
          throw new Error("Booking cannot be ignored");
        }

        await pool.query(
          `UPDATE cab_bookings
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE id = $1`,
          [bookingId]
        );

        socket.emit("rideAction:success", {
          bookingId,
          action: "ignored",
        });

        io.to(`booking:${bookingId}`).emit("booking:ignored", {
          bookingId,
        });
      }

      // ======================
      // 🚫 CANCEL RIDE (AFTER ACCEPTED)
      // ======================
      if (action === "cancel") {
        if (!["accepted", "in_progress"].includes(currentStatus)) {
          throw new Error("Ride cannot be cancelled at this stage");
        }

        await pool.query(
          `UPDATE cab_bookings
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE id = $1`,
          [bookingId]
        );

        socket.emit("rideAction:success", {
          bookingId,
          action: "cancelled",
        });

        io.to(`booking:${bookingId}`).emit("booking:cancelled", {
          bookingId,
          cancelledBy: "driver",
        });
      }

    } catch (err) {
      socket.emit("rideAction:error", {
        message: err.message,
      });
    }
  });

  // ===============================
  // ➕ NEW: VERIFY OTP
  // ===============================
  socket.on("verifyOtp", async ({ bookingId, otp }) => {
    try {
      const res = await pool.query(
        `UPDATE cab_bookings
         SET booking_verified=true, status='in_progress'
         WHERE id=$1 AND booking_otp=$2`,
        [bookingId, otp]
      );

      if (res.rowCount === 0) throw new Error("Invalid OTP");

      socket.emit("verifyOtp:success", { bookingId });
    } catch (err) {
      socket.emit("verifyOtp:error", { message: err.message });
    }
  });

  // ===============================
  // ➕ NEW: COMPLETE RIDE
  // ===============================
  socket.on("completeRide", async ({ bookingId, distance_km, total_fare }) => {
    try {

      // get the booking
      const bookingRes = await pool.query(
        `SELECT payment_intent_id 
        FROM cab_bookings
        WHERE id=$1`,
        [bookingId]
      );

      if (!bookingRes.rows.length)
        throw new Error("Booking not found");

      const paymentIntentId = bookingRes.rows[0].payment_intent_id;

      if (!paymentIntentId)
        throw new Error("No payment intent found for this booking");


      // update booking first
      await pool.query(
        `UPDATE cab_bookings
          SET status='completed',
           distance_km=COALESCE($1,distance_km),
           estimated_fare=COALESCE($2,estimated_fare),
           updated_at=NOW()
       WHERE id=$3`,
        [distance_km, total_fare, bookingId]
      );

      // ========= CAPTURE PAYMENT =========
      const stripeRes = await stripe.paymentIntents.capture(paymentIntentId);

      // update after successful payment
      await pool.query(
        `UPDATE cab_bookings
       SET payment_status='paid'
       WHERE id=$1`,
        [bookingId]
      );

      socket.emit("completeRide:success", {
        bookingId,
        amount: total_fare,
        payment_status: stripeRes.status,
        message: "Ride completed + payment captured"
      });

    } catch (err) {
      console.log(err);
      socket.emit("completeRide:error", { message: err.message });
    }
  });
  socket.on("currentLocation", async ({ driverId, lat, lng }) => {
    try {
      await pool.query(
        `UPDATE drivers
         SET current_lat = $1, current_lng = $2, updated_at = NOW()
         WHERE id = $3`,
        [lat, lng, driverId]
      );

      io.emit(`driver:${driverId}:location`, { lat, lng });
    } catch (err) {
      console.error("❌ driver:location error:", err.message);
    }
  });

};


