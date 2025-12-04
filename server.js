// server.js

require('dotenv').config();
const http = require("http");
const app = require("./app");
const socketIo = require("socket.io");
const pool = require("./dbconfig");

const PORT = process.env.PORT || 3001;  // single port

// create ONE shared HTTP server
const server = http.createServer(app);

// attach WebSocket to the SAME server
const io = socketIo(server, {
  cors: { origin: "*" },
});

// store connected drivers
let onlineDrivers = {};

io.on("connection", (socket) => {
  console.log("🟢 WebSocket connected:", socket.id);

  socket.on("driver_online", async (data) => {
    const { driverId } = data;
    onlineDrivers[driverId] = socket.id;

    const result = await pool.query(
      `SELECT id, user_id, cab_type_id, vehicle_number, current_lat, current_lng, is_available, status
       FROM drivers WHERE id = $1`,
      [driverId]
    );

    const driver = result.rows[0];
    io.to(socket.id).emit("driver_profile", driver);
    io.emit("driver_online_details", driver);
  });

  socket.on("driver_location_update", async (data) => {
    const { driverId, lat, lng } = data;
    await pool.query(
      "UPDATE drivers SET current_lat = $1, current_lng = $2, updated_at = NOW() WHERE id = $3",
      [lat, lng, driverId]
    );
    io.emit(`location_${driverId}`, { lat, lng });
  });

  socket.on("track_booking", async (data) => {
    const { bookingId, driverId } = data;
    socket.join(`booking_${bookingId}`);

    const result = await pool.query(
      "SELECT current_lat, current_lng FROM drivers WHERE id = $1",
      [driverId]
    );
    const location = result.rows[0];
    if (location) {
      io.to(socket.id).emit("init_location", {
        lat: location.current_lat,
        lng: location.current_lng,
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 WebSocket disconnected:", socket.id);
  });
});

// 🚀 Start ONE server only (API + Socket)
server.listen(PORT, () => {
  console.log(`🚀 Server + WebSocket running on port ${PORT}`);
});
