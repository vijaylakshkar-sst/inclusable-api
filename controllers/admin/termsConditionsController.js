const pool = require('../../dbconfig');
const Joi = require('joi');

// Validation schema
const termsSchema = Joi.object({
  title: Joi.string().required().messages({
    'any.required': 'Title is required',
    'string.empty': 'Title cannot be empty',
  }),
  content: Joi.string().required().messages({
    'any.required': 'Content is required',
    'string.empty': 'Content cannot be empty',
  }),
});

// CREATE
exports.createTerms = async (req, res) => {
  const { error, value } = termsSchema.validate(req.body);
  if (error) return res.status(400).json({status:false, error: error.details[0].message });

  try {
    const result = await pool.query(
      'INSERT INTO terms_conditions (title, content) VALUES ($1, $2) RETURNING *',
      [value.title, value.content]
    );
    res.status(201).json({status:true, data: { id: result.rows[0].id, ...value }});
  } catch (err) {
    res.status(500).json({status:false, error: err.message });
  }
};

// LIST ALL
exports.getAllTerms = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM terms_conditions ORDER BY created_at DESC');
    res.json({status:true, data: result.rows});
  } catch (err) {
    res.status(500).json({status:false, error: err.message });
  }
};

// GET ONE
exports.getTermById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM terms_conditions WHERE id=$1', [id]);
    if (result.rows.length === 0) return res.status(404).json({status:false, error: 'Term not found' });
    res.json({staus:true, data: { id: result.rows[0].id, ...result.rows[0] }});
  } catch (err) {
    res.status(500).json({status:false, error: err.message });
  }
};

// UPDATE
exports.updateTerm = async (req, res) => {
  const { id } = req.params;
  const { error, value } = termsSchema.validate(req.body);
  if (error) return res.status(400).json({status:false, error: error.details[0].message });

  try {
    const result = await pool.query(
      'UPDATE terms_conditions SET title=$1, content=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
      [value.title, value.content, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Term not found' });
    res.json({status:true, data: { id: result.rows[0].id, ...value }});
  } catch (err) {
    res.status(500).json({status:false, error: err.message });
  }
};

// DELETE
exports.deleteTerm = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM terms_conditions WHERE id=$1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Term not found' });
    res.json({status:true, message: 'Term deleted successfully' });
  } catch (err) {
    res.status(500).json({status:false, error: err.message });
  }
};
