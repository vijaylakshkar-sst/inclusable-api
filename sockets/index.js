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

    if (role === "Cab Owner" || role === "Driver") {
      try {
        const result = await pool.query(
          "SELECT id FROM drivers WHERE user_id = $1 LIMIT 1",
          [userId]
        );

        if (result.rows.length) {
          driverId = result.rows[0].id;
          socket.join(`driver:${driverId}`);
          console.log(`🚗 Driver joined room: driver:${driverId}`);
        }
      } catch (err) {
        console.error("❌ Error fetching driver ID:", err);
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
