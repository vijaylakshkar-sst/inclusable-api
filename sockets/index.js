const { Server } = require("socket.io");
const socketAuth = require("./socketAuth");
const driverHandler = require("./handlers/driver.handler");
const bookingHandler = require("./handlers/booking.handler");
const userHandler = require("./handlers/user.handler");
const pool = require("../dbconfig");

let io; // 🔥 GLOBAL SINGLETON

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: "*" },
  });

  io.use(socketAuth);

  io.on("connection", async (socket) => {
    console.log("🟢 Connected:", socket.id);

    const { userId, role } = socket.user || {};
    let driverId;

    if (role === "NDIS Member") {
      const bookingRes = await pool.query(
        `
      SELECT id, status, driver_id
      FROM cab_bookings
      WHERE user_id = $1
        AND status IN ('searching','accepted','arrived','in_progress')
      ORDER BY created_at DESC
      LIMIT 1
      `,
        [userId]
      );

      if (bookingRes.rows.length) {
        const booking = bookingRes.rows[0];

        socket.join(`booking:${booking.id}`);

        // 🔥 Immediately sync state
        socket.emit("booking:state", booking);
      }
    }


    if (role === "Cab Owner" || role === "Driver") {
      try {
        // 1️⃣ Resolve driverId
        const driverRes = await pool.query(
          "SELECT id FROM drivers WHERE user_id = $1 LIMIT 1",
          [userId]
        );

        if (!driverRes.rows.length) {
          console.warn(`⚠️ No driver found for user ${userId}`);
          return;
        }

        const driverId = driverRes.rows[0].id;

        // 2️⃣ Join permanent driver room
        socket.join(`driver:${driverId}`);
        console.log(`🚗 Driver joined room: driver:${driverId}`);

        // 3️⃣ Recover active booking (if any)
        const activeBookingRes = await pool.query(
          `
          SELECT id, status, user_id, updated_at
          FROM cab_bookings
          WHERE driver_id = $1
            AND status IN ('accepted', 'arrived', 'in_progress')
          ORDER BY updated_at DESC
          LIMIT 1
          `,
          [driverId]
        );

        if (activeBookingRes.rows.length) {
          const booking = activeBookingRes.rows[0];

          // 4️⃣ Join booking room
          socket.join(`booking:${booking.id}`);

          // 5️⃣ Sync booking state immediately
          socket.emit("booking:state", {
            bookingId: booking.id,
            status: booking.status,
            userId: booking.user_id,
          });

          console.log(
            `📦 Driver ${driverId} rejoined booking:${booking.id} (${booking.status})`
          );
        }
      } catch (err) {
        console.error("❌ Driver reconnect recovery failed:", err);
      }
    }

    socket.on("booking:join", ({ bookingId }) => {
      if (bookingId) {
        socket.join(`booking:${bookingId}`);
      }
    });

    driverHandler(io, socket, driverId);
    bookingHandler(io, socket);
    userHandler(io, socket);

    socket.on("disconnect", () => {
      console.log("🔴 Disconnected:", socket.id);
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error("❌ Socket.io not initialized. Call initSocket(server) first.");
  }
  return io;
}

module.exports = {
  initSocket,
  getIO,
};
