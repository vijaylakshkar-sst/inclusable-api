const pool = require('../dbconfig');
const { eventCreateSchema, eventUpdateSchema } = require('../validators/companyEventValidator');
const stripe = require('../stripe');
const BASE_EVENT_IMAGE_URL = process.env.BASE_EVENT_IMAGE_URL;
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;
const { sendNotification,sendNotificationToBusiness } = require("../hooks/notification");

exports.createCompanyEvent = async (req, res) => {

  const validation = eventCreateSchema.validate(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error.details[0].message });
  }

  const {
    event_name,
    event_types,
    disability_types,
    accessibility_types,
    event_description,
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
    longitude
  } = req.body;

  const user_id = req.user?.userId; // Auth middleware must set req.user
  if (!user_id) {
    return res.status(401).json({ status: false, error: 'Unauthorized' });
  }

  const thumbnail = req.files['event_thumbnail']?.[0]?.filename || null;
  const eventImages = req.files['event_images']?.map(file => file.filename) || [];

  try {


    const query = `
      INSERT INTO company_events (
        user_id, event_name, event_types, disability_types, accessibility_types,
        event_description, event_thumbnail, event_images,
        start_date, end_date, start_time, end_time,
        price_type, price, total_available_seats,
        event_address, how_to_reach_destination,latitude,longitude
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17,$18,$19
      ) RETURNING id
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
      event_types ? parseArray(event_types) : null,
      disability_types ? parseArray(disability_types) : null,
      accessibility_types ? parseArray(accessibility_types) : null,
      event_description,
      thumbnail,
      eventImages,
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
      longitude
    ];

    const result = await pool.query(query, values);
    const data = result.rows[0];

    const userData = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [user_id]
    );

    const user = userData.rows[0];

    const dynamicData = {
      title: "New Event Created!",
      body: `${user.business_name} just create event ${event_name}.`,
      type: "Event",
      id: data.id
    };

    await sendNotification({
      title: dynamicData.title,
      message: dynamicData.body,
      type: dynamicData.type,
      target: 'NDIS Member',
      id: data.id,
    });


    res.status(201).json({
      message: 'Event created successfully.',
      status: true
    });
  } catch (err) {
    console.error('Create Event Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to create event.' });
  }
};


exports.updateCompanyEvent = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user?.userId;

  if (!user_id) return res.status(401).json({ status: false, error: 'Unauthorized' });

  const validation = eventUpdateSchema.validate(req.body);
  if (validation.error) {
    return res.status(400).json({ status: false, error: validation.error.details[0].message });
  }

  try {
    // Check event belongs to company
    const checkEvent = await pool.query(
      'SELECT * FROM company_events WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );

    if (checkEvent.rows.length === 0) {
      return res.status(404).json({ status: false, error: 'Event not found or unauthorized' });
    }

    const oldEvent = checkEvent.rows[0];

    // Image updates
    const thumbnail = req.files?.['event_thumbnail']?.[0]?.filename || oldEvent.event_thumbnail;
    const eventImages = req.files?.['event_images']
      ? req.files['event_images'].map(f => String(f.filename))
      : Array.isArray(oldEvent.event_images) ? oldEvent.event_images : [];

    // Fields to update
    const fields = [
      'event_name', 'event_types', 'disability_types', 'accessibility_types',
      'event_description', 'start_date', 'end_date', 'start_time', 'end_time',
      'price_type', 'price', 'total_available_seats',
      'event_address', 'how_to_reach_destination', 'latitude', 'longitude'
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
        return input.split(',').map(s => s.trim());
      }
    };

    for (const field of fields) {
      const value = req.body[field];

      if (['event_types', 'disability_types', 'accessibility_types'].includes(field)) {
        const parsedArray = parseArray(value);
        updates.push(`${field} = $${index}::text[]`);
        values.push(parsedArray);
      } else {
        updates.push(`${field} = $${index}`);
        values.push(value ?? null);
      }

      index++;
    }



    // Add image fields
    updates.push(`event_thumbnail = $${index}`);
    values.push(thumbnail);
    index++;

    updates.push(`event_images = $${index}::text[]`);
    values.push(eventImages);
    index++;

    updates.push(`updated_at = NOW()`);

    // WHERE clause
    const updateQuery = `
      UPDATE company_events
      SET ${updates.join(', ')}
      WHERE id = $${index} AND user_id = $${index + 1}
    `;

    values.push(id);
    values.push(user_id);

    await pool.query(updateQuery, values);

    res.json({ status: true, message: 'Event updated successfully' });
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

    // Format event thumbnail URL
    booking.event_thumbnail = booking.event_thumbnail
      ? `${BASE_EVENT_IMAGE_URL}/${booking.event_thumbnail}`
      : null;

    // Format user image URL
    booking.user_image = booking.user_image
      ? `${BASE_IMAGE_URL}/${booking.user_image}`
      : null;

      console.log(booking,'data');
      
    res.json({
      status: true,
      data: booking
    });

  } catch (err) {
    console.error('Booking Detail Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch booking details' });
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
      AND (e.start_date + e.start_time::interval) >= NOW()
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


exports.createEventBooking = async (req, res) => {
  const user_id = req.user?.userId;
  const {
    company_id,
    event_id,
    event_price = 0.00,
    number_of_tickets,
    total_amount = 0.00,
    attendee_info // [{ name, email }]
  } = req.body;

  const eventCheck = await pool.query(
    'SELECT id, price_type, total_available_seats FROM company_events WHERE id = $1 AND user_id = $2',
    [event_id, company_id]
  );

  if (eventCheck.rows.length === 0) {
    return res.status(400).json({
      status: false,
      error: 'Invalid event_id or event does not belong to the specified company.',
    });
  }

  const eventDataCheck = eventCheck.rows[0];

  // Check seat availability before proceeding
  if (eventDataCheck.total_available_seats !== null &&
      eventDataCheck.total_available_seats < number_of_tickets) {
    return res.status(400).json({
      status: false,
      error: `Only ${eventDataCheck.total_available_seats} seats are available.`,
    });
  }

  if (eventDataCheck.price_type === 'Paid') {
    if (!user_id || !event_id || !company_id || !number_of_tickets || !total_amount) {
      return res.status(400).json({ status: false, error: 'Missing required fields' });
    }
  } else {
    if (!user_id || !event_id || !company_id || !number_of_tickets) {
      return res.status(400).json({ status: false, error: 'Missing required fields' });
    }
  }

  if (attendee_info && attendee_info.length !== number_of_tickets) {
    return res.status(400).json({ status: false, error: 'Attendee count mismatch with number_of_tickets' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const Feesquery = `
      SELECT 
        id, service_type, company_fee, driver_fee, member_fee, platform_fee, fee_type, updated_at
      FROM platform_fees
      WHERE service_type = 'Event Booking'
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(Feesquery);

    const platform_fee = eventDataCheck.price_type === 'Free' ? 0.00 : rows[0]?.platform_fee || 0.00;
    const status = eventDataCheck.price_type === 'Free' ? 'confirmed' : 'pending';
    // 1️⃣ Insert booking
    const bookingInsertQuery = `
      INSERT INTO event_bookings (
        user_id, company_id, event_id, event_price, number_of_tickets,
        total_amount, attendee_info, status, platform_fee
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;

    const bookingValues = [
      user_id,
      company_id,
      event_id,
      event_price || null,
      number_of_tickets,
      total_amount,
      JSON.stringify(attendee_info || []),
      status,
      platform_fee
    ];

    const bookingResult = await client.query(bookingInsertQuery, bookingValues);
    const booking_id = bookingResult.rows[0].id;

    // 2️⃣ Decrease available seats
    await client.query(
      `UPDATE company_events 
       SET total_available_seats = total_available_seats - $1,
           updated_at = NOW()
       WHERE id = $2`,
      [number_of_tickets, event_id]
    );

    // 3️⃣ Create Stripe payment if Paid
    let paymentIntent = null;
    if (eventDataCheck.price_type === 'Paid') {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(total_amount * 100),
        currency: 'aud',
        metadata: {
          booking_id: booking_id,
          user_id: user_id,
          event_id: event_id,
        },
      });

      await client.query(
        `INSERT INTO transactions (booking_id, user_id, event_id, payment_intent_id, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [booking_id, user_id, event_id, paymentIntent.id, total_amount, 'aud', 'pending']
      );
    }

    if(eventDataCheck.price_type === 'Free'){
      // 4️⃣ Send Notification
      const userData = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
      const user = userData.rows[0];

      const eventData = await pool.query(
        `SELECT id, event_name, user_id AS business_user_id
        FROM company_events WHERE id = $1`,
        [event_id]
      );

      const event = eventData.rows[0];
      if (event) {
        const dynamicData = {
          title: "New Booking Received!",
          body: `${user.full_name} just booked ${event.event_name}.`,
          type: "Booking",
          target: "Company",
          id: String(event.id),
          booking_id: String(booking_id),
        };

        await sendNotificationToBusiness({
          businessUserId: event.business_user_id,
          title: dynamicData.title,
          message: dynamicData.body,
          type: dynamicData.type,
          target: dynamicData.target,
          id: dynamicData.id,
          booking_id: dynamicData.booking_id
        });
      }
    }
    

    await client.query('COMMIT');

    return res.status(201).json({
      status: true,
      message: eventDataCheck.price_type === 'Paid'
        ? 'Booking initiated. Complete payment to confirm.'
        : 'Booking successfully created.',
      data: {
        clientSecret: paymentIntent ? paymentIntent.client_secret : null,
        bookingId: booking_id
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Booking Error:', err.message);
    return res.status(500).json({ status: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
};
