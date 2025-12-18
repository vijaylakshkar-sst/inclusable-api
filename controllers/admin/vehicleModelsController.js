const pool = require('../../dbconfig');

/**
 * ✅ Create a new vehicle model
 */
exports.createVehicleModel = async (req, res) => {
  const { make_id, cab_type_id, name } = req.body;

  if (!make_id || !cab_type_id || !name) {
    return res.status(400).json({
      status: false,
      message: 'make_id, cab_type_id and name are required',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO vehicle_models (make_id, cab_type_id, name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [make_id, cab_type_id, name]
    );

    return res.status(201).json({
      status: true,
      message: 'Vehicle model created successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('❌ Error creating vehicle model:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

/**
 * ✅ Get all vehicle models (with make & cab type)
 */
exports.getAllVehicleModels = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        vm.id,
        vm.name,
        vm.make_id,
        vm.cab_type_id,
        vm.created_at,
        vm.updated_at,
        mk.name AS make_name,
        ct.name AS cab_type_name
      FROM vehicle_models vm
      JOIN vehicle_makes mk ON vm.make_id = mk.id
      LEFT JOIN cab_types ct ON vm.cab_type_id = ct.id
      ORDER BY vm.id DESC
    `);

    return res.status(200).json({
      status: true,
      message: 'Vehicle models fetched successfully',
      data: result.rows,
    });
  } catch (error) {
    console.error('❌ Error fetching vehicle models:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

/**
 * ✅ Get vehicle model by ID
 */
exports.getVehicleModelById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        vm.*,
        mk.name AS make_name,
        ct.name AS cab_type_name
      FROM vehicle_models vm
      JOIN vehicle_makes mk ON vm.make_id = mk.id
      LEFT JOIN cab_types ct ON vm.cab_type_id = ct.id
      WHERE vm.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ status: false, message: 'Vehicle model not found' });
    }

    return res.status(200).json({
      status: true,
      message: 'Vehicle model fetched successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('❌ Error fetching vehicle model:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

/**
 * ✅ Update vehicle model
 */
exports.updateVehicleModel = async (req, res) => {
  const { id } = req.params;
  const { make_id, cab_type_id, name } = req.body;

  try {
    const result = await pool.query(
      `UPDATE vehicle_models
       SET 
         make_id = COALESCE($1, make_id),
         cab_type_id = COALESCE($2, cab_type_id),
         name = COALESCE($3, name),
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [make_id, cab_type_id, name, id]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ status: false, message: 'Vehicle model not found' });
    }

    return res.status(200).json({
      status: true,
      message: 'Vehicle model updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('❌ Error updating vehicle model:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};

/**
 * ✅ Delete vehicle model
 */
exports.deleteVehicleModel = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM vehicle_models WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ status: false, message: 'Vehicle model not found' });
    }

    return res.status(200).json({
      status: true,
      message: 'Vehicle model deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting vehicle model:', error.message);
    return res.status(500).json({ status: false, message: error.message });
  }
};
