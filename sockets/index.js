const { Server } = require("socket.io");
const socketAuth = require("./socketAuth");
const driverHandler = require("./handlers/driver.handler");
const bookingHandler = require("./handlers/booking.handler");
const userHandler = require("./handlers/user.handler");
const pool = require("../dbconfig"); // your MySQL pool
module.exports = function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.use(socketAuth);

  io.on("connection", async (socket) => {
    console.log("🟢 Connected:", socket.id);

    const { userId, role } = socket.user || {};
    let driverId;

    if (role === "Cab Owner" || role === "Driver") {
      try {
        // PostgreSQL uses $1 placeholders
        const result = await pool.query(
          "SELECT id FROM drivers WHERE user_id = $1 LIMIT 1",
          [userId]
        );

        if (result.rows.length > 0) {
          driverId = result.rows[0].id;
          socket.join(`driver:${driverId}`);
          console.log(`🚗 Driver joined room: driver:${driverId}`);
        } else {
          console.log(`⚠ No driver found for userId: ${userId}`);
        }
      } catch (err) {
        console.error("❌ Error fetching driver ID:", err);
      }
    }

      /* ================= BOOKING ROOM (🔥 FIX) ================= */
    socket.on("booking:join", ({ bookingId }) => {
      if (!bookingId) return;
      socket.join(`booking:${bookingId}`);
      console.log(`📦 Socket ${socket.id} joined booking:${bookingId}`);
    });

    driverHandler(io, socket, driverId);
    bookingHandler(io, socket);
    userHandler(io, socket);

    socket.on("disconnect", () => {
      console.log("🔴 Disconnected:", socket.id);
    });
  });

  return io;
};

