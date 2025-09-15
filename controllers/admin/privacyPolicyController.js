const pool = require('../../dbconfig');
const Joi = require('joi');

// Validation schema
const privacySchema = Joi.object({
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
exports.createPrivacy = async (req, res) => {
  const { error, value } = privacySchema.validate(req.body);
  if (error) return res.status(400).json({ status: false, data: error.details[0].message });

  try {
    const result = await pool.query(
      'INSERT INTO privacy_policies (title, content) VALUES ($1, $2) RETURNING *',
      [value.title, value.content]
    );
    res.status(201).json({ status: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: false, data: err.message });
  }
};

// LIST ALL
// LIST ALL (latest first)
exports.getAllPrivacy = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM privacy_policies ORDER BY created_at DESC');
    res.json({ status: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ status: false, data: err.message });
  }
};

// GET ONE
exports.getPrivacyById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM privacy_policies WHERE id=$1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ status: false, data: 'Privacy policy not found' });
    res.json({ status: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: false, data: err.message });
  }
};

// UPDATE
exports.updatePrivacy = async (req, res) => {
  const { id } = req.params;
  const { error, value } = privacySchema.validate(req.body);
  if (error) return res.status(400).json({ status: false, data: error.details[0].message });

  try {
    const result = await pool.query(
      'UPDATE privacy_policies SET title=$1, content=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
      [value.title, value.content, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ status: false, data: 'Privacy policy not found' });
    res.json({ status: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: false, data: err.message });
  }
};

// DELETE
exports.deletePrivacy = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM privacy_policies WHERE id=$1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ status: false, data: 'Privacy policy not found' });
    res.json({ status: true, data: 'Privacy policy deleted successfully' });
  } catch (err) {
    res.status(500).json({ status: false, data: err.message });
  }
};
