// controllers/userController.js
const pool = require('../../dbconfig');

exports.getNdisMembers = async (req, res) => {
  try {
    const query = `
      SELECT id, full_name, email, phone_number, profile_image,gender,date_of_birth created_at
      FROM users
      WHERE role = 'NDIS Member' AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query);
    res.json({ status: true, data: rows });
  } catch (error) {
    console.error('❌ Error fetching NDIS Members:', error.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.getBusinessMembers = async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM users
      WHERE role = 'Company' AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query);
    res.json({ status: true, data: rows });
  } catch (error) {
    console.error('❌ Error fetching Companies:', error.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.deleteUser = async (req, res) => {
    const { id } = req.params;

    try {
        // Check if user exists and not already deleted
        const checkQuery = 'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL';
        const { rows } = await pool.query(checkQuery, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: 'User not found' });
        }

        // Soft delete user by setting deleted_at
        const deleteQuery = 'UPDATE users SET deleted_at = NOW() WHERE id = $1';
        await pool.query(deleteQuery, [id]);

        return res.json({ status: true, message: 'User deleted successfully' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: 'Server error' });
    }
};

exports.getEventsByBusiness = async (req, res) => {
  const { id } = req.params; // company id

  try {
    const query = `
      SELECT 
        u.id AS company_id,
        u.full_name AS company_name,
        json_agg(
          json_build_object(
            'event_id', e.id,
            'event_name', e.event_name,
            'event_types', e.event_types,
            'disability_types', e.disability_types,
            'accessibility_types', e.accessibility_types,
            'event_description', e.event_description,
            'event_thumbnail', e.event_thumbnail,
            'event_images', e.event_images,
            'start_date', e.start_date,
            'end_date', e.end_date,
            'start_time', e.start_time,
            'end_time', e.end_time,
            'price_type', e.price_type,
            'price', e.price,
            'total_available_seats', e.total_available_seats,
            'event_address', e.event_address,
            'how_to_reach_destination', e.how_to_reach_destination,
            'created_at', e.created_at
          ) 
          ORDER BY e.created_at DESC
        ) FILTER (WHERE e.id IS NOT NULL) AS events
      FROM users u
      LEFT JOIN company_events e
        ON u.id = e.user_id
      WHERE u.role = 'Company' AND u.deleted_at IS NULL AND u.id = $1
      GROUP BY u.id, u.full_name;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Company not found' });
    }

    // If company exists but no events, set events to null
    if (!rows[0].events) {
      rows[0].events = null;
    }

    res.json({
      status: true,
      data: rows[0],
    });
  } catch (err) {
    console.error('❌ Error fetching events for company:', err.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.getUserEventBookings = async (req, res) => {
  const { id } = req.params; // user id

  try {
    const query = `
      SELECT 
        b.id AS booking_id,
        b.number_of_tickets,
        b.event_price,
        b.total_amount,
        b.created_at AS booking_date,
        e.id AS event_id,
        e.event_name,
        e.event_types,
        e.disability_types,
        e.accessibility_types,
        e.event_description,
        e.event_thumbnail,
        e.event_images,
        e.start_date,
        e.end_date,
        e.start_time,
        e.end_time,
        e.price_type,
        e.total_available_seats,
        e.event_address,
        e.how_to_reach_destination,
        c.id AS company_id,
        c.full_name AS company_name
      FROM event_bookings b
      JOIN company_events e ON b.event_id = e.id
      JOIN users c ON b.company_id = c.id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC;
    `;

    const { rows } = await pool.query(query, [id]);

    res.json({
      status: true,
      data: rows.length ? rows : null,
    });
  } catch (err) {
    console.error('❌ Error fetching user event bookings:', err.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

exports.deleteEvent = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE company_events SET is_deleted = true WHERE id = $1 AND is_deleted IS false',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: false, message: 'Event not found or already deleted' });
    }

    return res.status(200).json({ status: true, message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting event:', error);
    return res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};