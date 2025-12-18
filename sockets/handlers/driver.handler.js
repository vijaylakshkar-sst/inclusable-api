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

  // ================================
  // ✅ DRIVER GET BOOKINGS (NEW)
  // ================================
  socket.on("driver:getBookings", async () => {
    try {
      const userId = socket.user?.userId; // from JWT middleware

      if (!userId) {
        return socket.emit("driver:getBookings:error", {
          status: false,
          message: "Unauthorized"
        });
      }

      // 1️⃣ get driver id
      const driverResult = await pool.query(
        "SELECT id FROM drivers WHERE user_id = $1 LIMIT 1",
        [userId]
      );

      if (driverResult.rowCount === 0) {
        return socket.emit("driver:getBookings:error", {
          status: false,
          message: "Driver not found. Please complete your profile."
        });
      }

      const driverId = driverResult.rows[0].id;

      // 2️⃣ get pending bookings
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
        ORDER BY b.created_at DESC
      `;

      const bookings = await pool.query(query, [driverId]);

      socket.emit("driver:bookings", {
        status: true,
        count: bookings.rowCount,
        data: bookings.rows
      });

    } catch (err) {
      console.error("❌ driver:getBookings error:", err.message);

      socket.emit("driver:getBookings:error", {
        status: false,
        message: "Server error while fetching bookings"
      });
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

        await pool.query(
          `UPDATE cab_bookings
         SET driver_id = $1,
             status = 'accepted',
             updated_at = NOW()
         WHERE id = $2`,
          [driverId, bookingId]
        );

        socket.emit("rideAction:success", {
          bookingId,
          action: "accepted",
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
      await pool.query(
        `UPDATE cab_bookings
         SET status='completed',
             distance_km=COALESCE($1,distance_km),
             estimated_fare=COALESCE($2,estimated_fare),
             updated_at=NOW()
         WHERE id=$3`,
        [distance_km, total_fare, bookingId]
      );

      socket.emit("completeRide:success", { bookingId });
    } catch (err) {
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


