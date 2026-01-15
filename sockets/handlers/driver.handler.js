const pool = require("../../dbconfig");
const { sendNotificationToUser } = require("../../hooks/notification");
const store = require("../socketStore");
const stripe = require("../../stripe");
const { bookingTimers,bookingDriversMap } = require("../bookingTimers");
module.exports = (io, socket, driverId) => {

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
          bookingId,
          location: { lat, lng }
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

  socket.on("rideAction", async ({ bookingId, action }) => {
    const userId = socket.user?.userId;

    if (!bookingId || !["accept", "ignore", "cancel"].includes(action)) {
      return socket.emit("rideAction:error", {
        message: "Invalid ride action",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 🔹 Get driver
      const driverRes = await client.query(
        "SELECT id FROM drivers WHERE user_id = $1 LIMIT 1",
        [userId]
      );

      if (!driverRes.rows.length) {
        throw new Error("Driver not found");
      }

      const driverId = driverRes.rows[0].id;

      // 🔒 Lock booking row
      const bookingRes = await client.query(
        `SELECT status, user_id, estimated_fare
       FROM cab_bookings
       WHERE id = $1
       FOR UPDATE`,
        [bookingId]
      );

      if (!bookingRes.rows.length) {
        throw new Error("Booking not found");
      }

      const { status: currentStatus, user_id, estimated_fare } =
        bookingRes.rows[0];
console.log(currentStatus);

      /* =====================================================
         ✅ ACCEPT BOOKING (🔥 FIXED)
      ===================================================== */
      if (action === "accept") {

        // 🔥 CHANGE #1: searching (NOT pending)
        if (!["searching", "scheduled"].includes(currentStatus)) {
          throw new Error("Booking not available for acceptance");
        }

        // 🟢 ⭐ NEW — cancel searching Booking not available for acceptance
        const t = bookingTimers?.get(bookingId);
        if (t) {
          clearTimeout(t);
          bookingTimers.delete(bookingId);
        }
        
        // 🔹 Get Stripe customer id
        const userRes = await client.query(
          `SELECT stripe_customer_id FROM users WHERE id = $1`,
          [user_id]
        );

        if (!userRes.rows.length || !userRes.rows[0].stripe_customer_id) {
          throw new Error("Stripe customer not found");
        }

        const stripeCustomerId = userRes.rows[0].stripe_customer_id;

        const customer = await stripe.customers.retrieve(stripeCustomerId);

        let paymentMethodId =
          customer.invoice_settings.default_payment_method;

        if (!paymentMethodId) {
          const paymentMethods = await stripe.paymentMethods.list({
            customer: customer.id,
            type: "card",
            limit: 1,
          });

          if (!paymentMethods.data.length) {
            throw new Error("No card found. Please add a payment method.");
          }

          paymentMethodId = paymentMethods.data[0].id;

          await stripe.customers.update(customer.id, {
            invoice_settings: {
              default_payment_method: paymentMethodId,
            },
          });
        }

        // 🔐 Generate OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        // 💳 Stripe AUTH
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(estimated_fare * 100),
          currency: "aud",
          customer: customer.id,
          payment_method: paymentMethodId,
          confirm: true,
          capture_method: "manual",
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
          description: `Ride booking hold - ${bookingId}`,
          metadata: { bookingId, driverId },
        });

        // 🔥 CHANGE #2: atomic update (first driver wins)
        const acceptRes = await client.query(
          `
          UPDATE cab_bookings cb
          SET driver_id = $1,
              payment_intent_id = $2,
              booking_otp = $3,
              status = 'accepted',
              updated_at = NOW()
          FROM drivers d
          WHERE cb.id = $4
            AND cb.status IN ('searching', 'scheduled')
            AND d.id = $1
          RETURNING cb.*, d.vehicle_number
          `,
          [driverId, paymentIntent.id, otp, bookingId]
        );

        if (!acceptRes.rowCount) {
          throw new Error("Booking already taken by another driver");
        }

        await client.query(
          "UPDATE drivers SET is_available = false WHERE id = $1",
          [driverId]
        );

        /* =====================================================
        🔔 SEND NOTIFICATION TO PASSENGER (✅ NEW)
        ===================================================== */
        const booking = acceptRes.rows[0];

        const title = "Your Ride Has Been Accepted 🚗";
        const message = `${booking.license_number ? "Driver" : "Your driver"
          } has accepted your booking. Vehicle Number: ${booking.vehicle_number || "N/A"
          }`;

        await sendNotificationToUser({
          userId: booking.user_id,
          title,
          message,
          type: "Booking",
          target: "NDIS Member",
          booking_id: booking.id,
        });

        const driverRes = await client.query(
            `
            SELECT u.full_name
            FROM drivers d
            JOIN users u ON u.id = d.user_id
            WHERE d.id = $1
            `,
            [driverId]
          );

          const drivername = driverRes.rows[0]?.full_name || "Driver";

        bookingDriversMap.delete(bookingId);

        socket.join(`booking:${bookingId}`);

        await client.query("COMMIT");

        socket.emit("rideAction:success", {
          bookingId,
          action: "accepted",
          otp,
          payment_intent_id: paymentIntent.id,
          payment_status: paymentIntent.status,
        });

        io.to(`booking:${bookingId}`).emit("booking:accepted", {
          bookingId,
          driverId,
          drivername,
        });

        return;
      }

      /* =====================================================
         ❌ IGNORE BOOKING (🔥 FIXED – no cancellation)
      ===================================================== */
      if (action === "ignore") {
        // 🔥 Ignore should NOT cancel booking
        await client.query("COMMIT");

        socket.emit("rideAction:success", {
          bookingId,
          action: "ignored",
        });

        return;
      }

      /* =====================================================
         🚫 CANCEL RIDE (UNCHANGED)
      ===================================================== */
      if (action === "cancel") {
        if (!["accepted", "in_progress"].includes(currentStatus)) {
          throw new Error("Ride cannot be cancelled");
        }

       const cancelRes = await client.query(
          `UPDATE cab_bookings
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
          [bookingId]
        );

        await client.query(
          `UPDATE drivers
         SET is_available = true
         WHERE id = $1`,
          [driverId]
        );

        /* =====================================================
       🔔 SEND NOTIFICATION TO PASSENGER (✅ NEW)
       ===================================================== */
        const booking = cancelRes.rows[0];

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

        await client.query("COMMIT");

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
      await client.query("ROLLBACK");

      socket.emit("rideAction:error", {
        message: err.message || "Ride action failed",
      });
    } finally {
      client.release();
    }
  });

  // ===============================
  // ➕ NEW: VERIFY OTP
  // ===============================
  socket.on("verifyOtp", async ({ bookingId, otp }) => {
    try {
      const res = await pool.query(
      `
      UPDATE cab_bookings
      SET booking_verified = true,
          status = 'in_progress',
          updated_at = NOW()
      WHERE id = $1
        AND booking_otp = $2
        AND booking_verified = false
      RETURNING id, user_id
      `,
      [bookingId, otp]
    );

      // 🔒 STRICT GUARD
    if (!res.rowCount) {
      throw new Error("Invalid OTP or ride already started");
    }

    const booking = res.rows[0]; // ✅ ALWAYS defined now
    console.log(booking);
    
    /* =====================================================
       🔔 SEND NOTIFICATION TO PASSENGER
    ===================================================== */
    try {
      await sendNotificationToUser({
        userId: booking.user_id,
        title: "Ride Started 🚕",
        message: "Your ride has started successfully.",
        type: "Booking",
        target: "NDIS Member",
        booking_id: booking.id,
        data: { status: "in_progress" },
      });
    } catch (notifyErr) {
      console.error("🔔 Notification failed:", notifyErr.message);
    }
      // 🔥 BOTH USER + DRIVER
      io.to(`booking:${bookingId}`).emit("verifyOtp:success", {
        bookingId,
        status: "in_progress"
      });

    } catch (err) {
      socket.emit("verifyOtp:error", { message: err.message });
    }
  });

  // ===============================
  // ➕ NEW: COMPLETE RIDE
  // ===============================
  socket.on("completeRide", async ({ bookingId, distance_km, total_fare }) => {
    try {
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

      // update booking
      await pool.query(
        `UPDATE cab_bookings
       SET status='completed',
           distance_km=COALESCE($1,distance_km),
           estimated_fare=COALESCE($2,estimated_fare),
           updated_at=NOW()
       WHERE id=$3`,
        [distance_km, total_fare, bookingId]
      );

      // capture payment
      const stripeRes = await stripe.paymentIntents.capture(paymentIntentId);

      const resBooking = await pool.query(
        `UPDATE cab_bookings
       SET payment_status='paid'
       WHERE id=$1
       RETURNING id, user_id`,
        [bookingId]
      );    

      await pool.query(
        `UPDATE drivers
         SET is_available = true
         WHERE id = $1`,
        [driverId]
      );

      /* =====================================================
      🔔 SEND NOTIFICATION TO PASSENGER (✅ NEW)
      ===================================================== */
      const booking = resBooking.rows[0];

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


      // 🔥 EMIT TO BOOKING ROOM (USER + DRIVER)
      io.to(`booking:${bookingId}`).emit("completeRide:success", {
        bookingId,
        amount: total_fare,
        payment_status: stripeRes.status,
        message: "Ride completed & payment captured"
      });

    } catch (err) {
      console.error(err);
      socket.emit("completeRide:error", { message: err.message });
    }
  });
  socket.on("currentLocation", async ({ driverId, lat, lng }) => {
    try {
      console.log(driverId, lat, lng);
      
      const res = await pool.query(
        `UPDATE drivers
         SET current_lat = $1, current_lng = $2, updated_at = NOW()
         WHERE id = $3`,
        [lat, lng, driverId]
      );
      console.log("driverId:", driverId, typeof driverId);

      console.log(res);

      io.emit(`driver:${driverId}:location`, { lat, lng });
    } catch (err) {
      console.error("❌ driver:location error:", err.message);
    }
  });

};


