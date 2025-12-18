const pool = require('../../dbconfig');

// 🔹 CREATE cab type
exports.createCabType = async (req, res) => {
  const {
    name,
    standard_price,
    disability_feature_price,
  } = req.body;

  const thumbnail_url = req.file ? `${req.file.filename}` : null;

  try {
    const client = await pool.connect();

    const result = await client.query(
      `INSERT INTO cab_types 
      (name, standard_price, disability_feature_price, thumbnail_url)
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [
        name,
        standard_price,
        disability_feature_price,
        thumbnail_url,
      ]
    );

    client.release();
    res.status(201).json({ status: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ CREATE ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};

// 🔹 READ all cab types
exports.getAllCabTypes = async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT * FROM cab_types ORDER BY id ASC'
    );
    client.release();
    res.json({ status: true, data: result.rows });
  } catch (err) {
    console.error('❌ READ ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};

// 🔹 READ one cab type by ID
exports.getCabTypeById = async (req, res) => {
  const { id } = req.params;

  try {
    const client = await pool.connect();
    const result = await client.query(
      'SELECT * FROM cab_types WHERE id = $1',
      [id]
    );

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Cab type not found' });
    }

    res.json({ status: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ READ BY ID ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};

// 🔹 UPDATE cab type
exports.updateCabType = async (req, res) => {
  const { id } = req.params;

  const {
    name,
    standard_price,
    disability_feature_price,
  } = req.body;

  const thumbnail_url = req.file ? `${req.file.filename}` : null;

  try {
    const client = await pool.connect();

    const existing = await client.query(
      'SELECT * FROM cab_types WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      client.release();
      return res.status(404).json({ status: false, message: 'Cab type not found' });
    }

    const result = await client.query(
      `UPDATE cab_types
       SET 
         name = $1,
         standard_price = $2,
         disability_feature_price = $3,
         thumbnail_url = COALESCE($4, thumbnail_url),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [
        name,
        standard_price,
        disability_feature_price,
        thumbnail_url,
        id,
      ]
    );

    client.release();
    res.json({ status: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ UPDATE ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};

// 🔹 DELETE cab type
exports.deleteCabType = async (req, res) => {
  const { id } = req.params;

  try {
    const client = await pool.connect();
    const result = await client.query(
      'DELETE FROM cab_types WHERE id = $1 RETURNING *',
      [id]
    );

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Cab type not found' });
    }

    res.json({ status: true, message: 'Cab type deleted successfully' });
  } catch (err) {
    console.error('❌ DELETE ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};
