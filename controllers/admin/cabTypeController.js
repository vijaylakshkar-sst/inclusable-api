const pool = require('../../dbconfig');

// 🔹 CREATE cab type
exports.createCabType = async (req, res) => {
  const {
    name,
    category,
    description,
    fare_per_km,
    seating_capacity,
    luggage_capacity,
  } = req.body;

  const thumbnail_url = req.file ? `${req.file.filename}` : null;

  try {
    const client = await pool.connect();

    const result = await client.query(
      `INSERT INTO cab_types 
      (name, category, description, fare_per_km, seating_capacity, luggage_capacity, thumbnail_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [
        name,
        category,
        description,
        fare_per_km,
        seating_capacity,
        luggage_capacity,
        thumbnail_url,
      ]
    );

    res.status(201).json({ status: true, data: result.rows[0] });
    client.release();
  } catch (err) {
    console.error('❌ CREATE ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};

// 🔹 READ all cab types
exports.getAllCabTypes = async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM cab_types ORDER BY id ASC');
    res.json({ status: true, data: result.rows });
    client.release();
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
    const result = await client.query('SELECT * FROM cab_types WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Cab type not found' });
    }

    res.json({ status: true, data: result.rows[0] });
    client.release();
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
    category,
    description,
    fare_per_km,
    seating_capacity,
    luggage_capacity,
  } = req.body;

  const thumbnail_url = req.file ? `${req.file.filename}` : null;

  try {
    const client = await pool.connect();

    const existing = await client.query('SELECT * FROM cab_types WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Cab type not found' });
    }

    const result = await client.query(
      `UPDATE cab_types
       SET name=$1, category=$2, description=$3, fare_per_km=$4, seating_capacity=$5, luggage_capacity=$6,
           thumbnail_url = COALESCE($7, thumbnail_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        name,
        category,
        description,
        fare_per_km,
        seating_capacity,
        luggage_capacity,
        thumbnail_url,
        id,
      ]
    );

    res.json({ status: true, data: result.rows[0] });
    client.release();
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
    const result = await client.query('DELETE FROM cab_types WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Cab type not found' });
    }

    res.json({ status: true, message: 'Cab type deleted successfully' });
    client.release();
  } catch (err) {
    console.error('❌ DELETE ERROR:', err.message);
    res.status(500).json({ status: false, message: 'Server Error' });
  }
};
