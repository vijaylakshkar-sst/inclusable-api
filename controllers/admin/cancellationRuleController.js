const pool = require('../../dbconfig')

/**
 * CREATE cancellation rule
 */
exports.createRule = async (req, res) => {
  const { deduction_percentage, minimum_deduction_amount, active = true } = req.body;

  try {
    if (active) {
      const activeRule = await pool.query(
        `SELECT id FROM cancellation_rules WHERE active = true LIMIT 1`
      );

      if (activeRule.rows.length) {
        return res.status(400).json({
          status: false,
          message: "An active cancellation rule already exists. Deactivate it first."
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO cancellation_rules 
       (deduction_percentage, minimum_deduction_amount, active)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [deduction_percentage, minimum_deduction_amount, active]
    );

    res.status(201).json({
      status: true,
      message: "Cancellation rule created",
      data: result.rows[0]
    });

  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};

/**
 * GET all rules
 */
exports.getAllRules = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM cancellation_rules ORDER BY created_at DESC`
    );

    res.json({
      status: true,
      data: result.rows
    });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};

/**
 * GET rule by ID
 */
exports.getRuleById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM cancellation_rules WHERE id = $1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        status: false,
        message: "Rule not found"
      });
    }

    res.json({
      status: true,
      data: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};

/**
 * UPDATE rule
 */
exports.updateRule = async (req, res) => {
  const { id } = req.params;
  const { deduction_percentage, minimum_deduction_amount, active } = req.body;

  try {
    if (active === true) {
      const activeRule = await pool.query(
        `SELECT id FROM cancellation_rules 
         WHERE active = true AND id <> $1 LIMIT 1`,
        [id]
      );

      if (activeRule.rows.length) {
        return res.status(400).json({
          status: false,
          message: "Another active cancellation rule already exists."
        });
      }
    }

    const result = await pool.query(
      `UPDATE cancellation_rules
       SET deduction_percentage = COALESCE($1, deduction_percentage),
           minimum_deduction_amount = COALESCE($2, minimum_deduction_amount),
           active = COALESCE($3, active)
       WHERE id = $4
       RETURNING *`,
      [deduction_percentage, minimum_deduction_amount, active, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        status: false,
        message: "Rule not found"
      });
    }

    res.json({
      status: true,
      message: "Cancellation rule updated",
      data: result.rows[0]
    });

  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};

/**
 * DELETE rule
 */
exports.deleteRule = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM cancellation_rules WHERE id = $1 RETURNING *`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        status: false,
        message: "Rule not found"
      });
    }

    res.json({
      status: true,
      message: "Cancellation rule deleted"
    });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
};
