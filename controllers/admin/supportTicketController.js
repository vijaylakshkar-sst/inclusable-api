const pool = require('../../dbconfig');

// LIST ALL
exports.getAllSupportTickets = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM support_tickets ORDER BY created_at DESC');
    res.json({status:true, data: result.rows});
  } catch (err) {
    res.status(500).json({status:false, error: err.message });
  }
};


exports.updateTicketStatus = async (req, res) => {
  const { id } = req.params; // ticket id from URL
  const { status } = req.body; // new status

  try {
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // ✅ Update query
    const result = await pool.query(
      `UPDATE support_tickets SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.status(200).json({
      status: true,
      message: 'Ticket status updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error updating ticket status:', error);
    res.status(500).json({ status: false, error: 'Internal Server Error' });
  }
};