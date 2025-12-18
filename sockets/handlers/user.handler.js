const pool = require("../../dbconfig");

module.exports = (io, socket) => {

  socket.on("user:cab-find", async ({ lat, lng, radius_km = 10 }) => {
    try {
      // validation
      if (!lat || !lng) {
        return socket.emit("cab:find:result", {
          status: false,
          message: "Latitude and longitude are required",
          data: []
        });
      }

      const query = `
        SELECT 
          d.*,
          c.name AS cab_type_name,
          c.thumbnail_url,
          c.standard_price,
          (
            6371 * acos(
              cos(radians($1)) * cos(radians(d.current_lat)) *
              cos(radians(d.current_lng) - radians($2)) +
              sin(radians($1)) * sin(radians(d.current_lat))
            )
          ) AS distance_km
        FROM drivers d
        LEFT JOIN cab_types c ON d.cab_type_id = c.id
        WHERE d.is_available = true
          AND d.status = 'online'
          AND (
            6371 * acos(
              cos(radians($1)) * cos(radians(d.current_lat)) *
              cos(radians(d.current_lng) - radians($2)) +
              sin(radians($1)) * sin(radians(d.current_lat))
            )
          ) <= $3
        ORDER BY distance_km ASC
        LIMIT 20;
      `;

      const { rows } = await pool.query(query, [
        lat,
        lng,
        radius_km
      ]);

      if (rows.length === 0) {
        return socket.emit("cab:find:result", {
          status: false,
          message: "No rides found near your location",
          data: []
        });
      }

      socket.emit("cab:find:result", {
        status: true,
        message: "Rides found successfully",
        data: rows
      });

    } catch (error) {
      console.error("❌ CAB FIND SOCKET ERROR:", error.message);

      socket.emit("cab:find:result", {
        status: false,
        message: "Server error",
        data: []
      });
    }
  });

};
