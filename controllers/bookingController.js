const pool = require('../dbconfig');

const BASE_EVENT_IMAGE_URL = process.env.BASE_EVENT_IMAGE_URL;
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;
exports.getUserBookings = async (req, res) => {
  const user_id = req.user?.userId;

  if (!user_id) return res.status(401).json({ error: 'Unauthorized' });

  try {
    let { page = 1, limit = 50 } = req.query; // ✅ Get from query params
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const offset = (page - 1) * limit;

    // ✅ Get total count for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM event_bookings WHERE user_id = $1`,
      [user_id]
    );
    const total = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(total / limit);

    // ✅ Main paginated query
    const query = `
      SELECT 
        eb.id AS booking_id,
        eb.event_id,
        ce.event_name,
        ce.event_thumbnail,
        ce.start_date,
        ce.end_date,
        ce.start_time,
        ce.end_time,
        ce.event_address,
        eb.company_id,
        u.business_name AS company_name,
        eb.event_price,
        eb.event_booking_date,
        eb.number_of_tickets,
        eb.total_amount,
        eb.status,
        eb.created_at
      FROM event_bookings eb
      JOIN company_events ce ON eb.event_id = ce.id
      JOIN users u ON eb.company_id = u.id
      WHERE eb.user_id = $1
      ORDER BY eb.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [user_id, limit, offset]);

    // ✅ Attach full thumbnail URL
    const bookings = result.rows.map(b => ({
      ...b,
      event_thumbnail: b.event_thumbnail
        ? `${BASE_EVENT_IMAGE_URL}/${b.event_thumbnail}`
        : null
    }));

    res.json({
      status: true,
      pagination: {
        total,
        totalPages,
        currentPage: page,
        limit
      },
      data: bookings
    });
  } catch (err) {
    console.error('Get User Bookings Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch bookings' });
  }
};

exports.getUserBookingById = async (req, res) => {
  const user_id = req.user?.userId;
  const { id } = req.params;

  if (!user_id) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const query = `
      SELECT 
        eb.*,
        ce.event_name,
        ce.event_thumbnail,
        ce.start_date,
        ce.end_date,
        ce.start_time,
        ce.end_time,
        ce.event_address,
        ce.price_type,
        ce.how_to_reach_destination,
        ce.event_description,
        ce.latitude,
        ce.longitude,
        u.business_name AS company_name
      FROM event_bookings eb
      JOIN company_events ce ON eb.event_id = ce.id
      JOIN users u ON eb.company_id = u.id
      WHERE eb.id = $1 AND eb.user_id = $2
    `;

    const result = await pool.query(query, [id, user_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, error: 'Booking not found' });
    }

    const booking = result.rows[0];
    booking.event_thumbnail = booking.event_thumbnail
      ? `${BASE_EVENT_IMAGE_URL}/${booking.event_thumbnail}`
      : null;

    // Parse attendee_info JSON string (if stored as text)
    try {
      booking.attendee_info = typeof booking.attendee_info === 'string'
        ? JSON.parse(booking.attendee_info)
        : booking.attendee_info;
    } catch {
      booking.attendee_info = [];
    }

    res.json({ status: true, data: booking });
  } catch (err) {
    console.error('Get Booking Details Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch booking details' });
  }
};

exports.getEventSeatAvailability = async (req, res) => {
  const { eventId } = req.params;
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({
      status: false,
      message: "Date is required (YYYY-MM-DD)",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        ce.id AS event_id,
        ce.total_available_seats,
        COALESCE(SUM(eb.number_of_tickets), 0) AS booked_seats,
        (ce.total_available_seats - COALESCE(SUM(eb.number_of_tickets), 0)) AS available_seats
      FROM company_events ce
      LEFT JOIN event_bookings eb
        ON eb.event_id = ce.id
        AND eb.event_booking_date = $2
        AND eb.status IN ('confirmed')
      WHERE ce.id = $1
      GROUP BY ce.id
      `,
      [eventId, date]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        status: false,
        message: "Event not found",
      });
    }

    res.json({
      status: true,
      data: {
        event_id: result.rows[0].event_id,
        date,
        total_seats: result.rows[0].total_seats,
        booked_seats: result.rows[0].booked_seats,
        available_seats: result.rows[0].available_seats,
      },
    });
  } catch (err) {
    console.error("❌ Availability error:", err);
    res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};