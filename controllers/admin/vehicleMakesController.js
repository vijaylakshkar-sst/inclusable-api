const pool = require('../../dbconfig');

// CREATE
exports.createVehicleMake = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ status: false, message: 'Name is required' });

  try {
    const query = `
      INSERT INTO vehicle_makes (name)
      VALUES ($1)
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [name]);
    res.status(201).json({ status: true, message: 'Vehicle make created successfully', data: rows[0] });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};

// READ ALL
exports.getAllVehicleMakes = async (req, res) => {
  try {
    const query = `SELECT * FROM vehicle_makes ORDER BY id DESC;`;
    const { rows } = await pool.query(query);
    res.status(200).json({ status: true, data: rows });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};

// READ ONE
exports.getVehicleMakeById = async (req, res) => {
  const { id } = req.params;
  try {
    const query = `SELECT * FROM vehicle_makes WHERE id = $1;`;
    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0)
      return res.status(404).json({ status: false, message: 'Vehicle make not found' });
    res.status(200).json({ status: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};

// UPDATE
exports.updateVehicleMake = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) return res.status(400).json({ status: false, message: 'Name is required' });

  try {
    const query = `
      UPDATE vehicle_makes
      SET name = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [name, id]);
    if (rows.length === 0)
      return res.status(404).json({ status: false, message: 'Vehicle make not found' });
    res.status(200).json({ status: true, message: 'Vehicle make updated successfully', data: rows[0] });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};

// DELETE
exports.deleteVehicleMake = async (req, res) => {
  const { id } = req.params;
  try {
    const query = `DELETE FROM vehicle_makes WHERE id = $1 RETURNING *;`;
    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0)
      return res.status(404).json({ status: false, message: 'Vehicle make not found' });
    res.status(200).json({ status: true, message: 'Vehicle make deleted successfully' });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};
