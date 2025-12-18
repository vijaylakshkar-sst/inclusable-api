const pool = require("../../dbconfig");

exports.getDriverByUser = async (userId, client) => {
  const res = await client.query(
    "SELECT * FROM drivers WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  return res.rows[0] || null;
};
