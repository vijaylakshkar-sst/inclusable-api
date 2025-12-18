const pool = require("../../dbconfig");

module.exports = (io, socket) => {

  socket.on("booking:track", async ({ bookingId, driverId }) => {
    socket.join(`booking:${bookingId}`);

    const result = await pool.query(
      "SELECT current_lat, current_lng FROM drivers WHERE id = $1",
      [driverId]
    );

    const location = result.rows[0];
    if (location) {
      socket.emit("booking:initLocation", {
        lat: location.current_lat,
        lng: location.current_lng,
      });
    }
  });

};
