const pool = require('../dbconfig');
const { eventCreateSchema, eventUpdateSchema } = require('../validators/companyEventValidator');
const stripe = require('../stripe');
const BASE_EVENT_IMAGE_URL = process.env.BASE_EVENT_IMAGE_URL;
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;
const { sendNotification, sendNotificationToBusiness } = require("../hooks/notification");
// Fetch user’s plan dynamically
const { getCurrentAccess } = require('../hooks/checkPermissionHook');
const fs = require('fs');
const path = require('path');

// Helper: delete uploaded files when limit exceeded
const deleteUploadedFiles = (files) => {
  if (!files) return;

  Object.keys(files).forEach(field => {
    files[field].forEach(file => {
      const filePath = path.join(__dirname, '..', 'uploads', 'events', file.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  });
};

exports.createCompanyEvent = async (req, res) => {
  try {
    const validation = eventCreateSchema.validate(req.body);
    if (validation.error) {
      deleteUploadedFiles(req.files);
      return res.status(400).json({ error: validation.error.details[0].message });
    }

    const user_id = req.user?.userId;
    if (!user_id) {
      deleteUploadedFiles(req.files);
      return res.status(401).json({ status: false, error: 'Unauthorized' });
    }

    // ===========================
    //  PLAN + LIMIT CHECK INSIDE CONTROLLER
    // ===========================
    // const subscription = await getCurrentAccess(req, res, true);

    // const features = subscription?.plan?.features;
    // const maxAllowed = features?.maxEventPosts;

    // if (subscription.role !== 'Company') {
    //   deleteUploadedFiles(req.files);
    //   return res.status(403).json({
    //     status: false,
    //     message: 'Only company accounts can post events.'
    //   });
    // }

    // Count current month's events
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const countQuery = `
      SELECT COUNT(*) AS total_events
      FROM company_events
      WHERE user_id = $1 AND created_at >= $2 AND is_deleted = false
    `;
    const { rows } = await pool.query(countQuery, [user_id, startOfMonth]);
    const postedCount = parseInt(rows[0].total_events, 10);

    // LIMIT EXCEEDED → STOP + CLEANUP
    // if (maxAllowed !== 'Unlimited' && postedCount >= maxAllowed) {
    //   deleteUploadedFiles(req.files);

    //   return res.status(403).json({
    //     status: false,
    //     message: `You’ve reached your monthly limit of ${maxAllowed} events.`,
    //     current_plan: subscription.plan.name,
    //     upgrade_suggestion:
    //       subscription.plan.type === 'starter' ? 'growth' : 'professional'
    //   });
    // }

    // ===========================
    //  PAID TICKET CHECK
    // ===========================
    const {
      price_type,
      event_name,
      event_types,
      disability_types,
      accessibility_types,
      accessibility_features,
      event_description,
      start_date,
      end_date,
      start_time,
      end_time,
      price,
      total_available_seats,
      event_address,
      how_to_reach_destination,
      latitude,
      longitude,
      tickets = []
    } = req.body;

    let parsedTickets = [];

    if (tickets) {
      try {
        parsedTickets = JSON.parse(tickets);
      } catch (e) {
        return res.status(400).json({
          status: false,
          error: 'Invalid tickets JSON format'
        });
      }
    }

    // if (price_type === 'paid' && !features.canAccessPaidTicket) {
    //   deleteUploadedFiles(req.files);
    //   return res.status(400).json({
    //     status: false,
    //     message: `Your current plan (“${subscription.plan.name}”) does not allow paid ticketing. Please upgrade to enable this feature.`,
    //     upgrade_suggestion: 'growth'
    //   });
    // }

    // ===========================
    //  FILE PROCESSING
    // ===========================
    const thumbnail = req.files?.event_thumbnail?.[0]?.filename || null;
    const eventImages = req.files?.event_images?.map(f => f.filename) || [];
    const accessibilityImages = req.files?.accessibility_images?.map((f) => f.filename) || [];
    // ===========================
    //  DB INSERT
    // ===========================
    const query = `
      INSERT INTO company_events (
        user_id,
        event_name,
        event_types,
        disability_types,
        accessibility_types,
        event_description,
        event_thumbnail,
        event_images,
        accessibility_images,
        start_date,
        end_date,
        start_time,
        end_time,
        price_type,
        price,
        total_available_seats,
        event_address,
        how_to_reach_destination,
        latitude,
        longitude,
        accessibility_features
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,
        $10,$11,$12,$13,
        $14,$15,$16,
        $17,$18,$19,$20,$21
      )
      RETURNING id
    `;

    const parseArray = (input) => {
      if (!input) return null;
      try {
        const parsed = JSON.parse(input);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return input.split(',').map(s => s.trim());
      }
    };

    const values = [
      user_id,
      event_name,
      parseArray(event_types),
      parseArray(disability_types),
      parseArray(accessibility_types),
      event_description,
      thumbnail,
      eventImages,
      accessibilityImages,
      start_date,
      end_date,
      start_time,
      end_time,
      price_type,
      price || null,
      total_available_seats || null,
      event_address,
      how_to_reach_destination,
      latitude,
      longitude,
      parseArray(accessibility_features)
    ];

    const { rows: eventData } = await pool.query(query, values);

    const eventId = eventData[0].id;

    // ================= TICKETS INSERT =================
    if (Array.isArray(parsedTickets) && parsedTickets.length > 0) {
      const ticketQuery = `
        INSERT INTO company_event_tickets (
          company_event_id,
          ticket_type,
          price_type,
          ticket_price,
          total_seats,
          ticket_note,
          allow_companion,
          companion_ticket_type,
          companion_price_type,
          companion_ticket_price,
          companion_total_seats,
          companion_ticket_note
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `;

      for (const ticket of parsedTickets) {
        await pool.query(ticketQuery, [
          eventId,
          ticket.ticket_type,
          ticket.price_type,
          ticket.price_type === 'paid' ? ticket.ticket_price : null,
          ticket.total_seats || null,
          ticket.ticket_note || null,
          ticket.allow_companion || false,
          ticket.companion_ticket_type,
          ticket.companion_price_type,
          ticket.companion_price_type === 'paid' ? ticket.companion_ticket_price : null,
          ticket.companion_total_seats || null,
          ticket.companion_ticket_note || null,
        ]);
      }
    }


    return res.status(201).json({
      status: true,
      message: 'Event created successfully.'
    });

  } catch (err) {
    console.error("Create Event Error:", err.message);
    deleteUploadedFiles(req.files);
    return res.status(500).json({ status: false, error: 'Failed to create event.' });
  }
};


exports.updateCompanyEvent = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user?.userId;

  if (!user_id)
    return res.status(401).json({ status: false, error: 'Unauthorized' });

  const validation = eventUpdateSchema.validate(req.body);
  if (validation.error) {
    return res.status(400).json({
      status: false,
      error: validation.error.details[0].message,
    });
  }

  try {
    // ✅ 1. Check event belongs to company
    const checkEvent = await pool.query(
      'SELECT * FROM company_events WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );

    if (checkEvent.rows.length === 0) {
      return res
        .status(404)
        .json({ status: false, error: 'Event not found or unauthorized' });
    }

    const oldEvent = checkEvent.rows[0];

    // ✅ 2. Parse tickets (form-data JSON)
    let parsedTickets = [];
    if (req.body.tickets) {
      try {
        parsedTickets = JSON.parse(req.body.tickets);
        if (!Array.isArray(parsedTickets)) {
          throw new Error();
        }
      } catch {
        await client.query('ROLLBACK');
        return res.status(400).json({
          status: false,
          error: 'Invalid tickets JSON format',
        });
      }
    }


    // ✅ 3. Handle thumbnail (replace if new uploaded)
    const thumbnail =
      req.files?.['event_thumbnail']?.[0]?.filename ||
      oldEvent.event_thumbnail;

    // ✅ 3. Handle event images (append new ones to existing array)
    const oldImages = Array.isArray(oldEvent.event_images)
      ? oldEvent.event_images
      : [];

    const newImages = req.files?.['event_images']
      ? req.files['event_images'].map((f) => String(f.filename))
      : [];

    const mergedImages =
      newImages.length > 0 ? [...oldImages, ...newImages] : oldImages;

    const oldAccessibilityImages = Array.isArray(oldEvent.accessibility_images)
      ? oldEvent.accessibility_images
      : [];

    const newAccessibilityImages = req.files?.['accessibility_images']
      ? req.files['accessibility_images'].map((f) => String(f.filename))
      : [];

    const mergedAccessibilityImages =
      newAccessibilityImages.length > 0
        ? [...oldAccessibilityImages, ...newAccessibilityImages]
        : oldAccessibilityImages;

    // ✅ 4. Prepare fields for update
    const fields = [
      'event_name',
      'event_types',
      'disability_types',
      'accessibility_types',
      'event_description',
      'start_date',
      'end_date',
      'start_time',
      'end_time',
      'price_type',
      'price',
      'total_available_seats',
      'event_address',
      'how_to_reach_destination',
      'latitude',
      'longitude',
      'accessibility_features',
    ];

    const updates = [];
    const values = [];
    let index = 1;

    const parseArray = (input) => {
      if (!input) return null;
      try {
        const parsed = JSON.parse(input);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return input.split(',').map((s) => s.trim());
      }
    };

    // ✅ 5. Add each field dynamically
    for (const field of fields) {
      const value = req.body[field];

      if (
        ['event_types', 'disability_types', 'accessibility_types','accessibility_features'].includes(
          field
        )
      ) {
        const parsedArray = parseArray(value);
        updates.push(`${field} = $${index}::text[]`);
        values.push(parsedArray);
      } else {
        updates.push(`${field} = $${index}`);
        values.push(value ?? null);
      }

      index++;
    }

    // ✅ 6. Add image updates (keep old + add new)
    updates.push(`event_thumbnail = $${index}`);
    values.push(thumbnail);
    index++;

    updates.push(`event_images = $${index}::text[]`);
    values.push(mergedImages);
    index++;


    updates.push(`accessibility_images = $${index}::text[]`);
    values.push(mergedAccessibilityImages);
    index++;

    updates.push(`updated_at = NOW()`);

    // ✅ 7. WHERE clause
    const updateQuery = `
      UPDATE company_events
      SET ${updates.join(', ')}
      WHERE id = $${index} AND user_id = $${index + 1}
    `;

    values.push(id);
    values.push(user_id);

    await pool.query(updateQuery, values);

    // ✅ 5. Update tickets (delete + reinsert)
    if (parsedTickets.length > 0) {
      await pool.query(
        'DELETE FROM company_event_tickets WHERE company_event_id = $1',
        [id]
      );

      const ticketInsertQuery = `
        INSERT INTO company_event_tickets (
          company_event_id,
          ticket_type,
          price_type,
          ticket_price,
          total_seats,
          ticket_note,
          allow_companion,
          companion_ticket_type,
          companion_price_type,
          companion_ticket_price,
          companion_total_seats,
          companion_ticket_note
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `;

      for (const ticket of parsedTickets) {
        await pool.query(ticketInsertQuery, [
          id,
          ticket.ticket_type,
          ticket.price_type,
          ticket.price_type === 'paid' ? ticket.ticket_price : null,
          ticket.total_seats || null,
          ticket.ticket_note || null,
          ticket.allow_companion || false,
          ticket.companion_ticket_type || null,
          ticket.companion_price_type || null,
          ticket.companion_price_type === 'paid'
            ? ticket.companion_ticket_price
            : null,
          ticket.companion_total_seats || null,
          ticket.companion_ticket_note || null,
        ]);
      }
    }

    await pool.query('COMMIT');

    res.json({
      status: true,
      message: 'Event updated successfully.',
    });
  } catch (err) {
    console.error('Update Event Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to update event' });
  }
};

exports.deleteCompanyEventImage = async (req, res) => {
  const { id } = req.params;
  const { filename } = req.body; // or use req.query.filename
  const user_id = req.user?.userId;

  if (!user_id) {
    return res.status(401).json({ status: false, error: 'Unauthorized' });
  }

  if (!filename) {
    return res.status(400).json({ status: false, error: 'Filename is required' });
  }

  try {
    // 1. Check event and ownership
    const eventResult = await pool.query(
      'SELECT * FROM company_events WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );

    if (eventResult.rowCount === 0) {
      return res.status(404).json({ status: false, error: 'Event not found or unauthorized' });
    }

    const event = eventResult.rows[0];
    const images = Array.isArray(event.event_images) ? event.event_images : [];

    // 2. Filter out the image
    const updatedImages = images.filter(img => img !== filename);

    // 3. Update database
    await pool.query(
      'UPDATE company_events SET event_images = $1 WHERE id = $2 AND user_id = $3',
      [updatedImages, id, user_id]
    );

    // 4. Optionally delete the file from disk
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../../uploads/events', filename);

    fs.unlink(filePath, (err) => {
      if (err) {
        console.warn(`Could not delete image file: ${filePath}`, err.message);
      }
    });

    return res.json({ status: true, message: 'Image deleted successfully' });

  } catch (err) {
    console.error('Delete Image Error:', err.message);
    return res.status(500).json({ status: false, error: 'Failed to delete image' });
  }
};

exports.getCompanyEvents = async (req, res) => {
  const user_id = req.user?.userId;
  const {
    search,
    type,
    location,
    upcoming,
    lat,
    lng,
    radius,
    page = 1,
    limit = 50,
  } = req.query;

  const parsedLimit = parseInt(limit, 10);
  const parsedPage = parseInt(page, 10);
  const safeLimit = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
  const safePage = !isNaN(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const offset = (safePage - 1) * safeLimit;

  let query = `SELECT *, 
    (6371 * acos(
      cos(radians($1)) * cos(radians(latitude)) *
      cos(radians(longitude) - radians($2)) +
      sin(radians($1)) * sin(radians(latitude))
    )) AS distance
    FROM company_events
    WHERE is_deleted = FALSE`;

  const values = [];
  let paramIndex = 3; // because $1 and $2 are used for lat/lng

  // Add lat/lng base values (even if radius is not used)
  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  values.push(userLat || 0);
  values.push(userLng || 0);

  if (search) {
    values.push(`%${search}%`);
    query += ` AND event_name ILIKE $${paramIndex++}`;
  }

  if (type) {
    values.push(type);
    query += ` AND $${paramIndex++} = ANY(event_types)`;
  }

  if (location) {
    values.push(`%${location}%`);
    query += ` AND event_address ILIKE $${paramIndex++}`;
  }

  if (user_id) {
    values.push(user_id);
    query += ` AND user_id = $${paramIndex++}`;
  }

  if (upcoming === 'true') {
    values.push(new Date());
    query += ` AND start_date >= $${paramIndex++}`;
  }

  // 🔥 Radius filter (if lat/lng/radius provided)
  if (lat && lng && radius) {
    const radiusKm = parseFloat(radius);
    if (!isNaN(radiusKm)) {
      values.push(radiusKm);
      query += ` AND (6371 * acos(
        cos(radians($1)) * cos(radians(latitude)) *
        cos(radians(longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(latitude))
      )) <= $${paramIndex++}`;
    }
  }

  query += ` ORDER BY start_date ASC`;

  values.push(safeLimit);
  values.push(offset);
  query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;

  try {
    const result = await pool.query(query, values);

    const events = result.rows.map(event => ({
      ...event,
      event_thumbnail: event.event_thumbnail
        ? `${BASE_EVENT_IMAGE_URL}/${event.event_thumbnail}`
        : null,
      event_images: Array.isArray(event.event_images)
        ? event.event_images.map(img => `${BASE_EVENT_IMAGE_URL}/${img}`)
        : [],
      accessibility_images: Array.isArray(event.accessibility_images)
        ? event.accessibility_images.map(img => `${BASE_EVENT_IMAGE_URL}/${img}`)
        : [],
      distance: event.distance ? parseFloat(event.distance.toFixed(2)) : null
    }));

    res.json({ status: true, data: events });
  } catch (err) {
    console.error('Get Events Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch events' });
  }
};


exports.getEventById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        e.*,
        u.id AS company_id,
        u.business_name,
        u.business_category,
        u.business_email,
        u.business_phone_number,
        u.business_logo,
        u.abn_number,
        u.ndis_registration_number,
        u.website_url,
        u.year_experience,
        u.address AS business_address,
        u.business_overview
      FROM company_events e
      JOIN users u ON e.user_id = u.id
      WHERE e.id = $1 AND e.is_deleted = FALSE
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, error: 'Event not found' });
    }

    const event = result.rows[0];


    const ticketsResult = await pool.query(
      `
      SELECT
        id,
        ticket_type,
        price_type,
        ticket_price,
        total_seats,
        ticket_note,
        allow_companion,
        companion_ticket_type,
        companion_price_type,
        companion_ticket_price,
        companion_total_seats,
        companion_ticket_note
      FROM company_event_tickets
      WHERE company_event_id = $1
      ORDER BY id ASC
      `,
      [id]
    );

    const tickets = ticketsResult.rows.map((t) => ({
      id: t.id,
      ticket_type: t.ticket_type,
      price_type: t.price_type,
      ticket_price: t.ticket_price,
      total_seats: t.total_seats,
      ticket_note: t.ticket_note,
      allow_companion: t.allow_companion,

      companion_ticket_type: t.companion_ticket_type,
      companion_price_type: t.companion_price_type,
      companion_ticket_price: t.companion_ticket_price,
      companion_total_seats: t.companion_total_seats,
      companion_ticket_note: t.companion_ticket_note,
    }));

    const totalAvailableSeats = ticketsResult.rows.reduce(
      (sum, t) => sum + (Number(t.total_seats) || 0),
      0
    );

    // ✅ Safely parse arrays
    const parseStringToArray = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        return value
          .replace(/[{}]/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
      }
      return [];
    };

    event.event_types = parseStringToArray(event.event_types);
    event.disability_types = parseStringToArray(event.disability_types);
    event.accessibility_types = parseStringToArray(event.accessibility_types);

    // ✅ Format image URLs
    event.event_thumbnail = event.event_thumbnail
      ? `${BASE_EVENT_IMAGE_URL}/${event.event_thumbnail}`
      : null;

    event.event_images = Array.isArray(event.event_images)
      ? event.event_images.map((img) => `${BASE_EVENT_IMAGE_URL}/${img}`)
      : [];

    event.accessibility_images = Array.isArray(event.accessibility_images)
      ? event.accessibility_images.map((img) => `${BASE_EVENT_IMAGE_URL}/${img}`)
      : [];

    // ✅ Business info
    const company = {
      id: event.company_id,
      business_name: event.business_name,
      business_category: event.business_category,
      business_email: event.business_email,
      business_phone_number: event.business_phone_number,
      business_logo: event.business_logo
        ? `${BASE_IMAGE_URL}/${event.business_logo}`
        : null,
      abn_number: event.abn_number,
      ndis_registration_number: event.ndis_registration_number,
      website_url: event.website_url,
      year_experience: event.year_experience,
      address: event.business_address,
      business_overview: event.business_overview,
    };

    // ✅ Platform fees
    const Feesquery = `
      SELECT 
        id, 
        service_type,
        company_fee,
        driver_fee,
        member_fee,
        platform_fee,
        fee_type,
        updated_at
      FROM platform_fees
      WHERE service_type = 'Event Booking'
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    const { rows } = await pool.query(Feesquery);

    event.platform_fees = rows[0]?.platform_fee || 0;
    event.company_fees = rows[0]?.company_fee || 0;

    // ✅ Remove company fields from event
    const {
      company_id,
      business_name,
      business_category,
      business_email,
      business_phone_number,
      business_logo,
      abn_number,
      ndis_registration_number,
      website_url,
      year_experience,
      business_address,
      business_overview,
      ...cleanEvent
    } = event;

    // ✅ Fetch only confirmed bookings
    const bookingsResult = await pool.query(
      `
      SELECT 
        eb.id, 
        eb.user_id, 
        u.full_name, 
        u.email, 
        u.phone_number, 
        eb.number_of_tickets, 
        eb.total_amount, 
        u.profile_image
      FROM event_bookings eb
      JOIN users u ON eb.user_id = u.id
      WHERE eb.event_id = $1 
        AND eb.status = 'confirmed'  -- ✅ Only confirmed bookings
      ORDER BY eb.created_at DESC
      `,
      [id]
    );

    // ✅ Total confirmed bookings
    const totalBookingsResult = await pool.query(
      `SELECT COUNT(*) AS total_bookings FROM event_bookings WHERE event_id = $1 AND status = 'confirmed'`,
      [id]
    );

    const totalBookings = parseInt(totalBookingsResult.rows[0].total_bookings, 10);

    // ✅ Format booking user data
    const latestBookings = bookingsResult.rows.map((user) => ({
      ...user,
      profile_image_url: user.profile_image
        ? `${BASE_IMAGE_URL}/${user.profile_image}`
        : null,
    }));

    // ✅ Final response
    res.json({
      status: true,
      data: {
        ...cleanEvent,
        tickets,
        totalAvailableSeats,
        company,
        total_bookings: totalBookings,
        latest_bookings: latestBookings,
      },
    });
  } catch (err) {
    console.error('Get Event By ID Error:', err.message);
    res.status(500).json({ status: false, error: 'Error fetching event' });
  }
};


exports.deleteCompanyEvent = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user?.userId;

  if (!user_id)
    return res.status(401).json({ status: false, error: 'Unauthorized' });

  try {
    // 1️⃣ Check if the event exists and belongs to the user
    const eventRes = await pool.query(
      'SELECT id FROM company_events WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE',
      [id, user_id]
    );

    if (eventRes.rows.length === 0) {
      return res.status(404).json({
        status: false,
        error: 'Event not found or already deleted.',
      });
    }

    // 2️⃣ Check if anyone has booked this event (active or completed, not cancelled)
    const bookingRes = await pool.query(
      `
      SELECT id
      FROM event_bookings
      WHERE event_id = $1
        AND status NOT IN ('cancelled')
      LIMIT 1
      `,
      [id]
    );

    if (bookingRes.rows.length > 0) {
      return res.status(400).json({
        status: false,
        error:
          'This event cannot be deleted because one or more users have booked it.',
      });
    }

    // 3️⃣ Soft delete the event
    await pool.query(
      `
      UPDATE company_events
      SET is_deleted = TRUE, updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      `,
      [id, user_id]
    );

    res.json({
      status: true,
      message: 'Event deleted successfully.',
    });
  } catch (err) {
    console.error('Soft Delete Event Error:', err.message);
    res.status(500).json({
      status: false,
      error: 'Failed to delete event.',
    });
  }
};



exports.getBookingsByCompany = async (req, res) => {
  const company_id = req.user?.userId; // assumes auth middleware sets it
  if (!company_id) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { status, search, start_date, end_date, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Base WHERE clause
    let whereClause = `WHERE eb.company_id = $1`;
    const queryParams = [company_id];
    let paramIndex = 2;

    // ✅ Force confirmed bookings only (if no status filter passed)
    if (status) {
      whereClause += ` AND eb.status = $${paramIndex++}`;
      queryParams.push(status);
    } else {
      whereClause += ` AND eb.status = 'confirmed'`;
    }

    // ✅ Optional search filter
    if (search) {
      whereClause += ` AND (
        LOWER(u.full_name) LIKE LOWER($${paramIndex})
        OR LOWER(u.email) LIKE LOWER($${paramIndex})
        OR LOWER(ce.event_name) LIKE LOWER($${paramIndex})
      )`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // ✅ Date range filter
    if (start_date && end_date) {
      whereClause += ` AND eb.created_at BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      queryParams.push(start_date, end_date);
    }

    // ✅ Total count for pagination
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM event_bookings eb
      JOIN users u ON eb.user_id = u.id
      JOIN company_events ce ON eb.event_id = ce.id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(total / limit);

    // ✅ Main data query
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
        eb.user_id,
        u.full_name AS user_name,
        u.profile_image AS user_image,
        u.email AS user_email,
        eb.event_price,
        eb.number_of_tickets,
        eb.event_booking_date,
        eb.total_amount,
        eb.status,
        eb.created_at
      FROM event_bookings eb
      JOIN users u ON eb.user_id = u.id
      JOIN company_events ce ON eb.event_id = ce.id
      ${whereClause}
      ORDER BY eb.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    queryParams.push(limit, offset);

    const result = await pool.query(query, queryParams);

    // ✅ Format image URLs
    const bookings = result.rows.map((booking) => ({
      ...booking,
      event_thumbnail: booking.event_thumbnail
        ? `${BASE_EVENT_IMAGE_URL}/${booking.event_thumbnail}`
        : null,
      user_image: booking.user_image
        ? `${BASE_IMAGE_URL}/${booking.user_image}`
        : null,
    }));

    res.json({
      status: true,
      currentPage: parseInt(page),
      totalPages,
      totalRecords: total,
      limit: parseInt(limit),
      data: bookings,
    });
  } catch (err) {
    console.error('Company Bookings Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch bookings' });
  }
};

exports.getBookingById = async (req, res) => {
  const { id } = req.params;

  try {
    // ============================
    // 1️⃣ Fetch booking + joins
    // ============================
    const query = `
      SELECT 
        eb.id AS booking_id,
        eb.user_id,
        u.full_name AS user_name,
        u.email AS user_email,
        u.phone_number AS user_phone,
        u.profile_image AS user_image,

        eb.company_id,
        c.business_name,
        c.business_email,
        c.business_phone_number,

        eb.event_id,
        ce.event_name,
        ce.price_type,
        ce.event_thumbnail,
        ce.start_date,
        ce.end_date,
        ce.start_time,
        ce.end_time,
        ce.event_address,

        eb.event_price,
        eb.platform_fee,
        eb.number_of_tickets,
        eb.total_amount,
        eb.status,
        eb.attendee_info,
        eb.event_booking_date,
        eb.created_at

      FROM event_bookings eb
      LEFT JOIN users u ON eb.user_id = u.id
      LEFT JOIN users c ON eb.company_id = c.id
      LEFT JOIN company_events ce ON eb.event_id = ce.id
      WHERE eb.id = $1
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: false, error: 'Booking not found' });
    }

    const booking = result.rows[0];

    // ============================
    // 2️⃣ Ticket Summary
    // ============================
    const ticketSummaryRes = await pool.query(
      `
      SELECT
        bi.ticket_id,
        ct.ticket_type,
        ct.companion_ticket_type,
        bi.is_companion,
        SUM(bi.quantity) AS total_quantity,
        bi.price_per_ticket,
        SUM(bi.total_price) AS total_price
      FROM event_booking_items bi
      JOIN company_event_tickets ct
        ON ct.id = bi.ticket_id
      WHERE bi.booking_id = $1
      GROUP BY 
        bi.ticket_id,
        ct.ticket_type,
        ct.companion_ticket_type,
        bi.is_companion,
        bi.price_per_ticket
      ORDER BY bi.ticket_id
      `,
      [id]
    );

    const groupedTickets = {};

    for (const row of ticketSummaryRes.rows) {
      const ticketId = row.ticket_id;

      if (!groupedTickets[ticketId]) {
        groupedTickets[ticketId] = {
          ticket_type: row.ticket_type,
          quantity: 0,
          price_per_ticket: null,
          total_price: 0
        };
      }

      if (row.is_companion === true) {
        groupedTickets[ticketId].companion_ticket_type =
          row.companion_ticket_type;

        groupedTickets[ticketId].companion_quantity =
          Number(row.total_quantity);

        groupedTickets[ticketId].companion_price_per_ticket =
          Number(row.price_per_ticket);

        groupedTickets[ticketId].companion_total_price =
          Number(row.total_price);
      } else {
        groupedTickets[ticketId].quantity =
          Number(row.total_quantity);

        groupedTickets[ticketId].price_per_ticket =
          Number(row.price_per_ticket);

        groupedTickets[ticketId].total_price =
          Number(row.total_price);
      }
    }

    const ticket_summary = Object.values(groupedTickets);

    // ============================
    // 3️⃣ Parse attendee_info
    // ============================
    try {
      booking.attendee_info =
        typeof booking.attendee_info === "string"
          ? JSON.parse(booking.attendee_info)
          : booking.attendee_info || [];
    } catch {
      booking.attendee_info = [];
    }

    // ============================
    // 4️⃣ Format image URLs
    // ============================
    booking.event_thumbnail = booking.event_thumbnail
      ? `${BASE_EVENT_IMAGE_URL}/${booking.event_thumbnail}`
      : null;

    booking.user_image = booking.user_image
      ? `${BASE_IMAGE_URL}/${booking.user_image}`
      : null;

    // ============================
    // 5️⃣ Final Response
    // ============================
    res.json({
      status: true,
      data: {
        booking_id: booking.booking_id,
        status: booking.status,
        event_booking_date: booking.event_booking_date,
        created_at: booking.created_at,

        user: {
          user_id: booking.user_id,
          user_name: booking.user_name,
          user_email: booking.user_email,
          user_phone: booking.user_phone,
          user_image: booking.user_image,
        },

        company: {
          company_id: booking.company_id,
          business_name: booking.business_name,
          business_email: booking.business_email,
          business_phone_number: booking.business_phone_number,
        },

        event: {
          event_id: booking.event_id,
          event_name: booking.event_name,
          price_type: booking.price_type,
          event_thumbnail: booking.event_thumbnail,
          start_date: booking.start_date,
          end_date: booking.end_date,
          start_time: booking.start_time,
          end_time: booking.end_time,
          event_address: booking.event_address,
        },

        booking_summary: booking.attendee_info,   // ✅ added

        ticket_summary,                           // ✅ added

        event_price: Number(booking.event_price || 0),
        additional_charges: Number(booking.platform_fee || 0), // ✅ added
        total_amount: Number(booking.total_amount || 0),

        total_payable_amount:
          Number(booking.total_amount || 0),       // ✅ added
      },
    });

  } catch (err) {
    console.error('Booking Detail Error:', err.message);
    res.status(500).json({
      status: false,
      error: 'Failed to fetch booking details'
    });
  }
};



exports.getEvents = async (req, res) => {
  let {
    search,
    category,
    location,
    price_type,
    accessibility_type,
    lat,
    lng,
    radius,
    page = 1,
    limit = 50,
  } = req.body || {};

  const parsedLimit = parseInt(limit, 10);
  const parsedPage = parseInt(page, 10);
  const safeLimit = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
  const safePage = !isNaN(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const offset = (safePage - 1) * safeLimit;

  const values = [];
  let query = `
    SELECT 
      e.*, 
      u.id AS company_id,
      u.business_name,
      u.business_category,
      u.business_email,
      u.business_phone_number,
      u.business_logo,
      u.abn_number,
      u.ndis_registration_number,
      u.website_url,
      u.year_experience,
      u.address AS business_address,
      u.business_overview
  `;

  // If lat/lng provided, add calculated distance
  if (lat && lng) {
    values.push(lat);
    values.push(lng);
    query += `,
      (6371 * acos(
        cos(radians($${values.length - 1})) * cos(radians(e.latitude)) * 
        cos(radians(e.longitude) - radians($${values.length})) +
        sin(radians($${values.length - 1})) * sin(radians(e.latitude))
      )) AS distance_km
    `;
  }

  query += `
    FROM company_events e
    JOIN users u ON e.user_id = u.id
    WHERE e.is_deleted = FALSE
      AND e.end_date >= CURRENT_DATE
  `;

  // 🔍 Search by event name
  if (search) {
    values.push(`%${search}%`);
    query += ` AND e.event_name ILIKE $${values.length}`;
  }

  // 🏷️ Filter by multiple event types
  if (category) {
    const types = Array.isArray(category) ? category : category.split(',').map(t => t.trim());
    values.push(types);
    query += ` AND e.event_types && $${values.length}::text[]`;
  }

  // 📍 Filter by text location
  if (location) {
    values.push(`%${location}%`);
    query += ` AND e.event_address ILIKE $${values.length}`;
  }

  // 💰 Price filter
  if (price_type) {
    values.push(price_type);
    query += ` AND e.price_type = $${values.length}`;
  }

  // 🦽 Filter by multiple accessibility types
  if (accessibility_type) {
    const accessTypes = Array.isArray(accessibility_type)
      ? accessibility_type
      : accessibility_type.split(',').map(t => t.trim());
    values.push(accessTypes);
    query += ` AND e.accessibility_types && $${values.length}::text[]`;
  }

  // 📏 Radius filter (distance in km)
  if (lat && lng && radius) {
    // Use same lat/lng from earlier (2 placeholders already added)
    values.push(radius);
    query += ` AND (
      6371 * acos(
        cos(radians($1)) * cos(radians(e.latitude)) *
        cos(radians(e.longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(e.latitude))
      )
    ) <= $${values.length}`;
  }

  // 🕒 Sort by date or distance
  if (lat && lng) {
    query += ` ORDER BY distance_km ASC`;
  } else {
    query += ` ORDER BY e.start_date ASC, e.start_time ASC`;
  }

  // 📄 Pagination
  values.push(safeLimit);
  values.push(offset);
  query += ` LIMIT $${values.length - 1} OFFSET $${values.length}`;

  try {
    const result = await pool.query(query, values);

    const events = result.rows.map(event => ({
      id: event.id,
      event_name: event.event_name,
      event_types: event.event_types,
      disability_types: event.disability_types,
      accessibility_types: event.accessibility_types,
      event_description: event.event_description,
      start_date: event.start_date,
      end_date: event.end_date,
      start_time: event.start_time,
      end_time: event.end_time,
      price_type: event.price_type,
      price: event.price,
      total_available_seats: event.total_available_seats,
      event_address: event.event_address,
      how_to_reach_destination: event.how_to_reach_destination,
      latitude: event.latitude,
      longitude: event.longitude,
      distance_km: event.distance_km ? parseFloat(event.distance_km.toFixed(2)) : null,
      event_thumbnail: event.event_thumbnail
        ? `${BASE_EVENT_IMAGE_URL}/${event.event_thumbnail}`
        : null,
      event_images: Array.isArray(event.event_images)
        ? event.event_images.map(img => `${BASE_EVENT_IMAGE_URL}/${img}`)
        : [],
      created_at: event.created_at,
      updated_at: event.updated_at,

      company: {
        id: event.company_id,
        business_name: event.business_name,
        business_category: event.business_category,
        business_email: event.business_email,
        business_phone_number: event.business_phone_number,
        business_logo: event.business_logo
          ? `${BASE_IMAGE_URL}/${event.business_logo}`
          : null,
        abn_number: event.abn_number,
        ndis_registration_number: event.ndis_registration_number,
        website_url: event.website_url,
        year_experience: event.year_experience,
        address: event.business_address,
        business_overview: event.business_overview,
      },
    }));

    res.json({
      status: true,
      data: events,
    });
  } catch (err) {
    console.error('Get Events Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch events' });
  }
};


// exports.createEventBooking = async (req, res) => {
//   const user_id = req.user?.userId;
//   const {
//     company_id,
//     event_id,
//     event_price = 0.0,
//     number_of_tickets,
//     total_amount = 0.0,
//     attendee_info,
//     platform_fee = 0.0,
//     stripe_key,
//     event_booking_date,
//   } = req.body;

//   if (!stripe_key || !["test", "production"].includes(stripe_key)) {
//     return res.status(400).json({
//       status: false,
//       message: "Invalid environment. Use 'test' or 'production'.",
//     });
//   }

//   const StripeQuery = `
//     SELECT id, environment, publishable_key
//     FROM stripe_keys
//     WHERE environment = $1
//     LIMIT 1;
//   `;

//   const resultStripeKey = await pool.query(StripeQuery, [stripe_key]);

//   if (resultStripeKey.rows.length === 0) {
//     return res.status(404).json({
//       status: false,
//       message: "No Stripe keys found for environment: " + stripe_key,
//     });
//   }

//   const eventCheck = await pool.query(
//     `
//     SELECT id, price_type, total_available_seats
//     FROM company_events
//     WHERE id = $1 AND user_id = $2
//     `,
//     [event_id, company_id]
//   );

//   if (!eventCheck.rows.length) {
//     return res.status(400).json({
//       status: false,
//       error: "Invalid event_id or event does not belong to the specified company.",
//     });
//   }

//   const eventDataCheck = eventCheck.rows[0];

//   if (eventDataCheck.price_type === "Paid") {
//     if (!user_id || !event_id || !company_id || !number_of_tickets || !total_amount) {
//       return res.status(400).json({ status: false, error: "Missing required fields" });
//     }
//   } else {
//     if (!user_id || !event_id || !company_id || !number_of_tickets) {
//       return res.status(400).json({ status: false, error: "Missing required fields" });
//     }
//   }

//   if (attendee_info && attendee_info.length !== number_of_tickets) {
//     return res
//       .status(400)
//       .json({ status: false, error: "Attendee count mismatch with number_of_tickets" });
//   }

//   const client = await pool.connect();

//   try {
//     await client.query("BEGIN");

//     // 🔒 STEP 1: Lock event row
//     const eventLockRes = await client.query(
//       `
//       SELECT id, total_available_seats
//       FROM company_events
//       WHERE id = $1
//       FOR UPDATE
//       `,
//       [event_id]
//     );

//     if (!eventLockRes.rows.length) {
//       throw new Error("Event not found");
//     }

//     const { total_available_seats } = eventLockRes.rows[0];

//     // 🔢 STEP 2: Calculate booked seats for the given date
//     const bookedSeatsRes = await client.query(
//       `
//       SELECT COALESCE(SUM(number_of_tickets), 0) AS booked_seats
//       FROM event_bookings
//       WHERE event_id = $1
//         AND event_booking_date = $2
//         AND status IN ('confirmed', 'pending')
//       `,
//       [event_id, event_booking_date]
//     );

//     const bookedSeats = parseInt(bookedSeatsRes.rows[0].booked_seats, 10);
//     const availableSeats = total_available_seats - bookedSeats;

//     if (availableSeats < number_of_tickets) {
//       return res.status(400).json({
//         status: false,
//         message: `Only ${availableSeats} seats are available on ${event_booking_date}`,
//       });
//     }

//     const Feesquery = `
//       SELECT id, service_type, company_fee, driver_fee, member_fee,
//              platform_fee, fee_type, updated_at
//       FROM platform_fees
//       WHERE service_type = 'Event Booking'
//       ORDER BY updated_at DESC
//       LIMIT 1
//     `;
//     await pool.query(Feesquery);

//     const status = eventDataCheck.price_type === "Free" ? "confirmed" : "pending";

//     // 1️⃣ Insert booking
//     const bookingInsertQuery = `
//       INSERT INTO event_bookings (
//         user_id, company_id, event_id, event_price, number_of_tickets,
//         total_amount, attendee_info, status, platform_fee, event_booking_date
//       )
//       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
//       RETURNING id
//     `;

//     const bookingResult = await client.query(bookingInsertQuery, [
//       user_id,
//       company_id,
//       event_id,
//       event_price || null,
//       number_of_tickets,
//       total_amount,
//       JSON.stringify(attendee_info || []),
//       status,
//       platform_fee,
//       event_booking_date,
//     ]);

//     const booking_id = bookingResult.rows[0].id;

//     // 3️⃣ Stripe payment (Paid only)
//     let paymentIntent = null;
//     if (eventDataCheck.price_type === "Paid") {
//       paymentIntent = await stripe.paymentIntents.create({
//         amount: Math.round(total_amount * 100),
//         currency: "aud",
//         metadata: { booking_id, user_id, event_id },
//       });

//       await client.query(
//         `
//         INSERT INTO transactions
//         (booking_id, user_id, event_id, payment_intent_id, amount, currency, status)
//         VALUES ($1,$2,$3,$4,$5,$6,$7)
//         `,
//         [booking_id, user_id, event_id, paymentIntent.id, total_amount, "aud", "pending"]
//       );
//     }

//     // 4️⃣ Notification for free events
//     if (eventDataCheck.price_type === "Free") {
//       const userData = await pool.query("SELECT * FROM users WHERE id = $1", [user_id]);
//       const eventData = await pool.query(
//         `SELECT id, event_name, user_id AS business_user_id
//          FROM company_events WHERE id = $1`,
//         [event_id]
//       );

//       if (eventData.rows.length) {
//         await sendNotificationToBusiness({
//           businessUserId: eventData.rows[0].business_user_id,
//           title: "New Booking Received!",
//           message: `${userData.rows[0].full_name} just booked ${eventData.rows[0].event_name}.`,
//           type: "Booking",
//           target: "Company",
//           id: String(event_id),
//           booking_id: String(booking_id),
//         });
//       }
//     }

//     await client.query("COMMIT");

//     return res.status(201).json({
//       status: true,
//       message:
//         eventDataCheck.price_type === "Paid"
//           ? "Booking initiated. Complete payment to confirm."
//           : "Booking successfully created.",
//       data: {
//         clientSecret: paymentIntent ? paymentIntent.client_secret : null,
//         bookingId: booking_id,
//         stripeKey: resultStripeKey.rows[0],
//       },
//     });
//   } catch (err) {
//     await client.query("ROLLBACK");
//     console.error("❌ Booking Error:", err.message);
//     return res.status(500).json({ status: false, error: "Internal server error" });
//   } finally {
//     client.release();
//   }
// };



// exports.cancelBooking = async (req, res) => {
//   const { bookingId } = req.params;

//   const client = await pool.connect();
//   try {
//     await client.query('BEGIN');

//     const booking = await client.query(
//       `SELECT event_id, number_of_tickets, status FROM event_bookings WHERE id = $1`,
//       [bookingId]
//     );

//     if (!booking.rows.length) return res.status(404).json({ status: false, message: 'Booking not found' });

//     if (booking.rows[0].status !== 'pending') {
//       return res.status(400).json({ status: false, message: 'Booking already finalized' });
//     }

//     const { event_id, number_of_tickets } = booking.rows[0];

//     // Restore seats
//     // await client.query(
//     //   `UPDATE company_events
//     //    SET total_available_seats = total_available_seats + $1,
//     //        updated_at = NOW()
//     //    WHERE id = $2`,
//     //   [number_of_tickets, event_id]
//     // );

//     // Update booking + transaction
//     await client.query(`UPDATE event_bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
//     await client.query(`UPDATE transactions SET status = 'cancelled' WHERE booking_id = $1`, [bookingId]);

//     await client.query('COMMIT');
//     return res.status(400).json({ status: false, error: 'Booking cancelled and seats restored.' });
//   } catch (err) {
//     await client.query('ROLLBACK');
//     console.error('Cancel booking error:', err.message);
//     return res.status(500).json({ status: false, error: 'Internal server error' });
//   } finally {
//     client.release();
//   }
// };

exports.createEventBooking = async (req, res) => {
  const user_id = req.user?.userId;

  const {
    company_id,
    event_id,
    event_booking_date,
    platform_fee = 0,
    total_amount = 0.0,
    stripe_key,
    items = [],
    attendee_info = [],
  } = req.body;

  if (!items.length) {
    return res.status(400).json({
      status: false,
      message: "At least one ticket item is required",
    });
  }

  if (!stripe_key || !["test", "production"].includes(stripe_key)) {
    return res.status(400).json({
      status: false,
      message: "Invalid environment. Use 'test' or 'production'.",
    });
  }

  // 🔑 Fetch Stripe key
  const stripeKeyRes = await pool.query(
    `
    SELECT id, environment, publishable_key
    FROM stripe_keys
    WHERE environment = $1
    LIMIT 1
    `,
    [stripe_key]
  );

  if (!stripeKeyRes.rows.length) {
    return res.status(404).json({
      status: false,
      message: "No Stripe keys found for environment: " + stripe_key,
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ============================
    // 🔒 STEP 1: LOCK TICKET ROWS
    // ============================
    const ticketIds = [...new Set(items.map(i => i.ticket_id))];

    const lockedTicketsRes = await client.query(
      `
      SELECT 
        id,
        total_seats,
        allow_companion,
        companion_total_seats
      FROM company_event_tickets
      WHERE id = ANY($1::int[])
      FOR UPDATE
      `,
      [ticketIds]
    );

    if (lockedTicketsRes.rows.length !== ticketIds.length) {
      throw new Error("Invalid ticket selected");
    }

    // ============================
    // 📊 STEP 2: FETCH BOOKED SEATS (NO LOCK)
    // ============================
    const bookedSeatsRes = await client.query(
      `
      SELECT
        bi.ticket_id,
        bi.is_companion,
        COALESCE(SUM(bi.quantity), 0) AS booked_seats
      FROM event_booking_items bi
      JOIN event_bookings b
        ON b.id = bi.booking_id
      WHERE bi.ticket_id = ANY($1::int[])
        AND b.event_booking_date = $2
        AND b.status IN ('pending', 'confirmed')
      GROUP BY bi.ticket_id, bi.is_companion
      `,
      [ticketIds, event_booking_date]
    );

   const bookedMap = {};

  bookedSeatsRes.rows.forEach(row => {
    const key = `${row.ticket_id}_${row.is_companion}`;
    bookedMap[key] = Number(row.booked_seats);
  });

    // ============================
    // ✅ STEP 3: VALIDATE EACH TICKET
    // ============================
   for (const item of items) {
    const ticketRow = lockedTicketsRes.rows.find(
      t => t.id === item.ticket_id
    );

    const isCompanion = item.is_companion === true;

    let totalSeats;
    let bookedSeats;

    if (isCompanion) {
      if (!ticketRow.allow_companion) {
        throw new Error(`Companion not allowed for ${item.ticket_type}`);
      }

      totalSeats = Number(ticketRow.companion_total_seats || 0);
      bookedSeats = bookedMap[`${item.ticket_id}_true`] || 0;
    } else {
      totalSeats = Number(ticketRow.total_seats || 0);
      bookedSeats = bookedMap[`${item.ticket_id}_false`] || 0;
    }

    const availableSeats = Math.max(0, totalSeats - bookedSeats);


    if (item.quantity > availableSeats) {
      throw new Error(
        `Only ${availableSeats} ${
          isCompanion ? "companion" : "main"
        } seats available for ${item.ticket_type}`
      );
    }
  }

    // ============================
    // 💰 STEP 4: CALCULATE TOTAL
    // ============================
    // const total_amount = items.reduce(
    //   (sum, i) => sum + i.quantity * i.price_per_ticket,
    //   0
    // );

    // ============================
    // 🧾 STEP 5: INSERT BOOKING
    // ============================
    const bookingRes = await client.query(
      `
      INSERT INTO event_bookings
      (
        user_id,
        company_id,
        event_id,
        total_amount,
        platform_fee,
        status,
        event_booking_date,
        attendee_info
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id
      `,
      [
        user_id,
        company_id,
        event_id,
        total_amount,
        platform_fee,
        "pending",
        event_booking_date,
        JSON.stringify(attendee_info || []),
      ]
    );

    const booking_id = bookingRes.rows[0].id;

    // ============================
    // 🎟 STEP 6: INSERT BOOKING ITEMS
    // ============================
    for (const item of items) {
      await client.query(
        `
        INSERT INTO event_booking_items
        (
          booking_id,
          event_id,
          ticket_id,
          ticket_type,
          is_companion,
          quantity,
          price_per_ticket,
          total_price
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          booking_id,
          event_id,
          item.ticket_id,
          item.ticket_type,
          item.is_companion || false,
          item.quantity,
          item.price_per_ticket,
          item.quantity * item.price_per_ticket,
        ]
      );
    }

    // ============================
    // 👥 STEP 6: INSERT ATTENDEES
    // ============================

   // 🔢 1️⃣ Calculate total ticket quantity
    const totalTicketQty = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );

    const providedAttendeeCount = attendee_info.length;

    // 🚨 Optional safety check
    if (providedAttendeeCount > totalTicketQty) {
      throw new Error("Attendees count cannot exceed total ticket quantity");
    }

    let ticketCounter = 1;

    // 2️⃣ Insert provided attendees first
    for (const attendee of attendee_info) {
      const attendeeName =
        attendee.full_name && attendee.full_name.trim() !== ""
          ? attendee.full_name
          : `Ticket ${ticketCounter}`;

      await client.query(
        `
        INSERT INTO event_booking_attendees
        (
          booking_id,
          attendee_name,
          attendee_email,
          checkin_status
        )
        VALUES ($1,$2,$3,$4)
        `,
        [
          booking_id,
          attendeeName,
          attendee.email || null,
          "pending",
        ]
      );

      ticketCounter++;
    }

    // 3️⃣ Auto-create remaining attendees
    const remainingTickets = totalTicketQty - providedAttendeeCount;

    for (let i = 0; i < remainingTickets; i++) {
      await client.query(
        `
        INSERT INTO event_booking_attendees
        (
          booking_id,
          attendee_name,
          attendee_email,
          checkin_status
        )
        VALUES ($1,$2,$3,$4)
        `,
        [
          booking_id,
          `Ticket ${ticketCounter}`,
          null,
          "pending",
        ]
      );

      ticketCounter++;
    }
    // ============================
    // 💳 STEP 7: STRIPE PAYMENT
    // ============================
    let clientSecret = null;

    if (total_amount > 0) {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(total_amount * 100),
        currency: "aud",
        metadata: {
          booking_id,
          user_id,
          event_id,
        },
      });

      await client.query( 
        `
        INSERT INTO transactions
        (booking_id, user_id, event_id, payment_intent_id, amount, currency, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [booking_id, user_id, event_id, paymentIntent.id, total_amount, "aud", "pending"]
      );

      clientSecret = paymentIntent.client_secret;
    } else {
      await client.query(
        `UPDATE event_bookings SET status = 'confirmed' WHERE id = $1`,
        [booking_id]
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      status: true,
      message:
        total_amount > 0
          ? "Booking initiated. Complete payment."
          : "Booking confirmed.",
      data: {
        booking_id,
        clientSecret,
        stripeKey: stripeKeyRes.rows[0],
        total_amount,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Booking error:", err.message);
    return res.status(400).json({
      status: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
};


exports.cancelBooking = async (req, res) => {
  const { bookingId } = req.params;

  try {
    const result = await pool.query(
      `UPDATE event_bookings SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`,
      [bookingId]
    );

    if (!result.rowCount) {
      return res.status(400).json({
        status: false,
        message: "Booking already finalized or not found",
      });
    }

    res.json({
      status: true,
      message: "Booking cancelled successfully",
    });
  } catch (err) {
    console.error("Cancel booking error:", err.message);
    res.status(500).json({ status: false, error: "Server error" });
  }
};