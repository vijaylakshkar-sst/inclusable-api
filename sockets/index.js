const { Server } = require("socket.io");
const socketAuth = require("./socketAuth");
const driverHandler = require("./handlers/driver.handler");
const bookingHandler = require("./handlers/booking.handler");
const userHandler = require("./handlers/user.handler");

module.exports = function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  // optional auth middleware
  io.use(socketAuth);

  io.on("connection", (socket) => {
    console.log("🟢 Connected:", socket.id);

    // attach feature handlers
    driverHandler(io, socket);
    bookingHandler(io, socket);
    userHandler(io, socket);

    socket.on("disconnect", () => {
      console.log("🔴 Disconnected:", socket.id);
    });
  });

  return io;
};
