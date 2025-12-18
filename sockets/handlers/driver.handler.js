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
  socket.on("driver:location", async ({ driverId, lat, lng }) => {
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
  socket.on("driver:updateStatus", async ({ status }) => {
    const userId = socket.user?.userId;

    if (!["online", "offline"].includes(status)) {
      return socket.emit("driver:updateStatus:error", {
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
        return socket.emit("driver:updateStatus:error", {
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
      io.emit("driver:statusUpdated", { driverId, status });

    } catch (err) {
      await client.query("ROLLBACK");
      socket.emit("driver:updateStatus:error", {
        message: err.message
      });
    } finally {
      client.release();
    }
  });

  // ===============================
  // ➕ NEW: ACCEPT BOOKING
  // ===============================
  socket.on("driver:acceptBooking", async ({ bookingId }) => {
    const userId = socket.user?.userId;

    try {
      const driverRes = await pool.query(
        "SELECT id FROM drivers WHERE user_id = $1 LIMIT 1",
        [userId]
      );

      if (!driverRes.rows[0]) throw new Error("Driver not found");

      const driverId = driverRes.rows[0].id;

      const bookingRes = await pool.query(
        "SELECT status FROM cab_bookings WHERE id=$1",
        [bookingId]
      );

      if (!bookingRes.rows[0] || bookingRes.rows[0].status !== "pending") {
        throw new Error("Booking not available");
      }

      await pool.query(
        `UPDATE cab_bookings
         SET driver_id=$1, status='accepted', updated_at=NOW()
         WHERE id=$2`,
        [driverId, bookingId]
      );

      socket.emit("driver:acceptBooking:success", { bookingId });
      io.to(`booking:${bookingId}`).emit("booking:accepted", { driverId });

    } catch (err) {
      socket.emit("driver:acceptBooking:error", { message: err.message });
    }
  });

  // ===============================
  // ➕ NEW: IGNORE BOOKING
  // ===============================
  socket.on("driver:ignoreBooking", async ({ bookingId }) => {
    try {
      await pool.query(
        `UPDATE cab_bookings
         SET status='cancelled', updated_at=NOW()
         WHERE id=$1 AND status='pending'`,
        [bookingId]
      );

      socket.emit("driver:ignoreBooking:success", { bookingId });
    } catch (err) {
      socket.emit("driver:ignoreBooking:error", { message: err.message });
    }
  });

  // ===============================
  // ➕ NEW: VERIFY OTP
  // ===============================
  socket.on("driver:verifyOtp", async ({ bookingId, otp }) => {
    try {
      const res = await pool.query(
        `UPDATE cab_bookings
         SET booking_verified=true, status='in_progress'
         WHERE id=$1 AND booking_otp=$2`,
        [bookingId, otp]
      );

      if (res.rowCount === 0) throw new Error("Invalid OTP");

      socket.emit("driver:verifyOtp:success", { bookingId });
    } catch (err) {
      socket.emit("driver:verifyOtp:error", { message: err.message });
    }
  });

  // ===============================
  // ➕ NEW: COMPLETE RIDE
  // ===============================
  socket.on("driver:completeRide", async ({ bookingId, distance_km, total_fare }) => {
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

      socket.emit("driver:completeRide:success", { bookingId });
    } catch (err) {
      socket.emit("driver:completeRide:error", { message: err.message });
    }
  });

  // ===============================
  // ➕ NEW: CANCEL RIDE
  // ===============================
  socket.on("driver:cancelRide", async ({ bookingId }) => {
    try {
      await pool.query(
        `UPDATE cab_bookings
         SET status='cancelled', updated_at=NOW()
         WHERE id=$1`,
        [bookingId]
      );

      socket.emit("driver:cancelRide:success", { bookingId });
    } catch (err) {
      socket.emit("driver:cancelRide:error", { message: err.message });
    }
  });

};
