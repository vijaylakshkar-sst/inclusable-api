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

  if (!user_id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ============================
    // 1️⃣ Fetch booking + event
    // ============================
    const bookingQuery = `
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

    const bookingResult = await pool.query(bookingQuery, [id, user_id]);

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        status: false,
        error: 'Booking not found',
      });
    }

    const booking = bookingResult.rows[0];

    // ============================
    // 2️⃣ Fetch ticket summary
    // ============================
    const ticketSummaryRes = await pool.query(
      `
      SELECT
        ticket_type,
        is_companion,
        SUM(quantity) AS total_quantity,
        price_per_ticket,
        SUM(total_price) AS total_price
      FROM event_booking_items
      WHERE booking_id = $1
      GROUP BY ticket_type, is_companion, price_per_ticket
      ORDER BY is_companion ASC
      `,
      [id]
    );

    const ticket_summary = ticketSummaryRes.rows.map((row) => ({
      ticket_type: row.ticket_type,
      is_companion: row.is_companion,
      quantity: Number(row.total_quantity),
      price_per_ticket: Number(row.price_per_ticket),
      total_price: Number(row.total_price),
    }));

    // ============================
    // 3️⃣ Parse attendee info
    // ============================
    try {
      booking.attendee_info =
        typeof booking.attendee_info === 'string'
          ? JSON.parse(booking.attendee_info)
          : booking.attendee_info || [];
    } catch {
      booking.attendee_info = [];
    }

    // ============================
    // 4️⃣ Format image URL
    // ============================
    booking.event_thumbnail = booking.event_thumbnail
      ? `${BASE_EVENT_IMAGE_URL}/${booking.event_thumbnail}`
      : null;

      const QRCode = require('qrcode');

    const qrData = {
      booking_code: booking.booking_code
    };

    const qrImage = await QRCode.toDataURL(JSON.stringify(qrData));
      
    // ============================
    // 5️⃣ Final response
    // ============================
    res.json({
      status: true,
      data: {
        booking_id: booking.id,
        status: booking.status,
        booking_code: booking.booking_code,
        event_booking_date: booking.event_booking_date,
        total_amount: Number(booking.total_amount),
        platform_fee: Number(booking.platform_fee || 0),
        qrCode:qrImage,
        event: {
          event_name: booking.event_name,
          event_thumbnail: booking.event_thumbnail,
          start_date: booking.start_date,
          end_date: booking.end_date,
          start_time: booking.start_time,
          end_time: booking.end_time,
          address: booking.event_address,
          latitude: booking.latitude,
          longitude: booking.longitude,
          description: booking.event_description,
        },

        company: {
          company_name: booking.company_name,
        },

        booking_summary: booking.attendee_info, // Theodore, Hudson, Luca

        ticket_summary, // ✅ THIS POWERS THE UI

        additional_charges: Number(booking.platform_fee || 0),
        total_payable_amount:
          Number(booking.total_amount) +
          Number(booking.platform_fee || 0),
      },
    });
  } catch (err) {
    console.error('Get Booking Details Error:', err.message);
    res.status(500).json({
      status: false,
      error: 'Failed to fetch booking details',
    });
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
      WITH total_seats AS (
        SELECT
          company_event_id AS event_id,
          COALESCE(SUM(total_seats), 0) AS total_seats
        FROM company_event_tickets
        WHERE company_event_id = $1
        GROUP BY company_event_id
      ),
      booked_seats AS (
        SELECT
          b.event_id,
          COALESCE(SUM(bi.quantity), 0) AS booked_seats
        FROM event_bookings b
        JOIN event_booking_items bi
          ON bi.booking_id = b.id
        WHERE b.event_id = $1
          AND b.event_booking_date = $2
          AND b.status = 'confirmed'
        GROUP BY b.event_id
      )
      SELECT
        ts.event_id,
        ts.total_seats,
        COALESCE(bs.booked_seats, 0) AS booked_seats,
        (ts.total_seats - COALESCE(bs.booked_seats, 0)) AS available_seats
      FROM total_seats ts
      LEFT JOIN booked_seats bs
        ON bs.event_id = ts.event_id
      `,
      [eventId, date]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        status: false,
        message: "Event not found or no tickets configured",
      });
    }

    res.json({
      status: true,
      data: {
        event_id: result.rows[0].event_id,
        date,
        total_seats: Number(result.rows[0].total_seats),
        booked_seats: Number(result.rows[0].booked_seats),
        available_seats: Math.max(
          0,
          Number(result.rows[0].available_seats)
        ),
      },
    });
  } catch (err) {
    console.error("❌ Availability error:", err.message);
    res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};


exports.scanQrCode = async (req, res) => {
  const { booking_code } = req.body;

  try {

    // 🔎 Get booking + event + company
    const bookingRes = await pool.query(
      `
      SELECT 
        b.*,
        e.event_name,
        e.start_date,
        e.end_date,
        e.start_time,
        e.end_time,
        e.event_address,
        e.event_thumbnail,
        e.latitude,
        e.longitude,
        u.id AS company_id,
        u.full_name AS company_name,
        u.email AS company_email
      FROM event_bookings b
      JOIN company_events e ON e.id = b.event_id
      JOIN users u ON u.id = e.user_id
      WHERE b.booking_code = $1
      AND b.status = 'confirmed'
      AND e.is_deleted = FALSE
      `,
      [booking_code]
    );

    if (!bookingRes.rows.length) {
      return res.status(400).json({
        status: false,
        message: "Invalid or Expired Ticket"
      });
    }

    const booking = bookingRes.rows[0];

    // 👥 Fetch attendees
    const attendeesRes = await pool.query(
      `
      SELECT id, attendee_name, attendee_email, checkin_status, checkin_time
      FROM event_booking_attendees
      WHERE booking_id = $1
      ORDER BY id ASC
      `,
      [booking.id]
    );

    return res.json({
      status: true,
      booking,
      event: {
        event_name: booking.event_name,
        start_date: booking.start_date,
        end_date: booking.end_date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        event_address: booking.event_address,
        event_thumbnail: booking.event_thumbnail,
        latitude: booking.latitude,
        longitude: booking.longitude,
      },
      company: {
        company_id: booking.company_id,
        company_name: booking.company_name,
        company_email: booking.company_email
      },
      attendees: attendeesRes.rows
    });

  } catch (err) {
    console.error("❌ Scan QR Error:", err.message);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};

exports.checkInAttendees = async (req, res) => {
  const { booking_id, attendee_ids } = req.body;
  const businessUserId = req.user.userId; // logged-in company

  if (!booking_id || !attendee_ids?.length) {
    return res.status(400).json({
      status: false,
      message: "booking_id and attendee_ids are required"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔐 1️⃣ Verify booking + event ownership
    const bookingRes = await client.query(
      `
      SELECT b.id
      FROM event_bookings b
      JOIN company_events e ON e.id = b.event_id
      WHERE b.id = $1
      AND b.status = 'confirmed'
      AND e.user_id = $2
      `,
      [booking_id, businessUserId]
    );

    if (!bookingRes.rows.length) {
      throw new Error("Invalid booking or unauthorized access");
    }

    // 🔎 2️⃣ Validate attendees belong to booking
    const validAttendees = await client.query(
      `
      SELECT id
      FROM event_booking_attendees
      WHERE booking_id = $1
      AND id = ANY($2::int[])
      `,
      [booking_id, attendee_ids]
    );

    if (validAttendees.rows.length !== attendee_ids.length) {
      throw new Error("Some attendees are invalid");
    }

    // ✅ 3️⃣ Update only pending attendees
    const updateRes = await client.query(
      `
      UPDATE event_booking_attendees
      SET checkin_status = 'checked_in',
          checkin_time = NOW()
      WHERE booking_id = $1
      AND id = ANY($2::int[])
      AND checkin_status = 'pending'
      RETURNING id
      `,
      [booking_id, attendee_ids]
    );

    await client.query("COMMIT");

    return res.json({
      status: true,
      message: "Ticket Verified",
      checked_in_count: updateRes.rowCount
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Check-in Error:", err.message);

    return res.status(400).json({
      status: false,
      message: err.message
    });
  } finally {
    client.release();
  }
};