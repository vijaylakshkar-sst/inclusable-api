
const pool = require('../dbconfig');

exports.createDriver = async (req, res) => {
  const {
    user_id,
    cab_type_id,
    vehicle_number,
    license_number,
    current_lat,
    current_lng,
    is_available,
    status,
  } = req.body;

  try {
    
    const query = `
      INSERT INTO drivers (
        user_id, cab_type_id, vehicle_number, license_number, current_lat, current_lng, is_available, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;

    const result = await pool.query(query, [
      user_id,
      cab_type_id,
      vehicle_number,
      license_number,
      current_lat,
      current_lng,
      is_available,
      status,
    ]);

    res.status(201).json({ status: true, data: result.rows[0] });   
  } catch (err) {
    console.error('❌ CREATE DRIVER ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};

exports.updateDriver = async (req, res) => {
  const { id } = req.params;
  const {
    cab_type_id,
    vehicle_number,
    license_number,
    current_lat,
    current_lng,
    is_available,
    status,
  } = req.body;

  try {  

    const result = await pool.query(
      `UPDATE drivers
       SET cab_type_id = $1,
           vehicle_number = $2,
           license_number = $3,
           current_lat = $4,
           current_lng = $5,
           is_available = $6,
           status = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *;`,
      [
        cab_type_id,
        vehicle_number,
        license_number,
        current_lat,
        current_lng,
        is_available,
        status,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Driver not found' });
    }

    res.json({ status: true, data: result.rows[0] });
   
  } catch (err) {
    console.error('❌ UPDATE DRIVER ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};