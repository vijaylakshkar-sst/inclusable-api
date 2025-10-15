const pool = require('../dbconfig');
const { eventCreateSchema, eventUpdateSchema } = require('../validators/companyEventValidator');
const stripe = require('../stripe');
const BASE_EVENT_IMAGE_URL = process.env.BASE_EVENT_IMAGE_URL;
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;

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

    const values = [
      user_id,
      event_name,
      event_types ? event_types.split(',').map(s => s.trim()) : null,
      disability_types ? disability_types.split(',').map(s => s.trim()) : null,
      accessibility_types ? accessibility_types.split(',').map(s => s.trim()) : null,
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
      'event_address', 'how_to_reach_destination','latitude','longitude'
    ];

    const updates = [];
    const values = [];
    let index = 1;

    for (const field of fields) {
      const value = req.body[field];

      if (['event_types', 'disability_types', 'accessibility_types'].includes(field)) {
        let parsedArray = [];

        if (Array.isArray(value)) {
          parsedArray = value.map(v => v.toString());
        } else if (typeof value === 'string') {
          parsedArray = value.split(',').map(v => v.trim().toString());
        } else if (typeof value === 'number') {
          parsedArray = [value.toString()];
        } else {
          parsedArray = [];
        }

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
  const { search, type, state, company_id, upcoming, page = 1, limit = 20 } = req.query;

  const parsedLimit = parseInt(limit, 10);
  const parsedPage = parseInt(page, 10);

  // Fallbacks
  const safeLimit = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
  const safePage = !isNaN(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const offset = (safePage - 1) * safeLimit;

  let query = `SELECT * FROM company_events WHERE is_deleted = FALSE`;
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    query += ` AND event_name ILIKE $${values.length}`;
  }

  if (type) {
    values.push(type);
    query += ` AND $${values.length} = ANY(event_types)`;
  }

  if (state) {
    values.push(`%${state}%`);
    query += ` AND event_address ILIKE $${values.length}`;
  }

  // if (company_id && company_id !== '') {
  //   const parsedCompanyId = parseInt(company_id, 10);
  //   if (!isNaN(parsedCompanyId)) {
  //     values.push(parsedCompanyId);
  //     query += ` AND user_id = $${values.length}`;
  //   }
  // }

  if (user_id) {
    values.push(user_id);
    query += ` AND user_id = $${values.length}`;
  }

  if (upcoming === 'true') {
    values.push(new Date()); // current date-time
    query += ` AND start_date >= $${values.length}`;
  }

  query += ` ORDER BY start_date ASC`;

  // Pagination
  // const offset = (page - 1) * limit;
  values.push(safeLimit);  // LIMIT
  values.push(offset); 
  query += ` LIMIT $${values.length - 1} OFFSET $${values.length}`; 

  try {
    const result = await pool.query(query, values);

    const events = result.rows.map(event => {
      return {
        ...event,
        event_thumbnail: event.event_thumbnail
          ? `${BASE_EVENT_IMAGE_URL}/${event.event_thumbnail}`
          : null,
        event_images: Array.isArray(event.event_images)
          ? event.event_images.map(img => `${BASE_EVENT_IMAGE_URL}/${img}`)
          : []
      };
    });

    res.json({ status: true, data: events });
  } catch (err) {
    console.error('Get Events Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to fetch events' });
  }
};


exports.getEventById = async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch event and company details
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

    // Format images
    event.event_thumbnail = event.event_thumbnail
      ? `${BASE_EVENT_IMAGE_URL}/${event.event_thumbnail}`
      : null;

    event.event_images = Array.isArray(event.event_images)
      ? event.event_images.map(img => `${BASE_EVENT_IMAGE_URL}/${img}`)
      : [];

    // Business object
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

    // Remove business fields from event object
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

    // --- New: fetch total bookings and latest 4 booked users ---
    const bookingsResult = await pool.query(
      `
      SELECT eb.id, eb.user_id, u.full_name, u.email, u.phone_number, eb.number_of_tickets, eb.total_amount, u.profile_image
      FROM event_bookings eb
      JOIN users u ON eb.user_id = u.id
      WHERE eb.event_id = $1
      ORDER BY eb.created_at DESC
      LIMIT 4
      `,
      [id]
    );

    const totalBookingsResult = await pool.query(
      `
      SELECT COUNT(*) AS total_bookings
      FROM event_bookings
      WHERE event_id = $1
      `,
      [id]
    );

    const totalBookings = parseInt(totalBookingsResult.rows[0].total_bookings, 10);
    const latestBookings = bookingsResult.rows.map(user => ({
      ...user,
      profile_image_url: user.profile_image ? `${BASE_IMAGE_URL}/${user.profile_image}` : null,
    }));

    
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

  if (!user_id) return res.status(401).json({ status: false, error: 'Unauthorized' });

  try {
    // Check if the event exists and belongs to the user
    const checkEvent = await pool.query(
      'SELECT id FROM company_events WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE',
      [id, user_id]
    );

    if (checkEvent.rows.length === 0) {
      return res.status(400).json({ status: false, error: 'Event not found or already deleted' });
    }

    // Soft delete
    await pool.query(
      'UPDATE company_events SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );

    res.json({ status: true, message: 'Event soft-deleted successfully' });
  } catch (err) {
    console.error('Soft Delete Event Error:', err.message);
    res.status(500).json({ status: false, error: 'Failed to delete event' });
  }
};


exports.getBookingsByCompany = async (req, res) => {
  const company_id = req.user?.userId; // assumes auth middleware sets it

  if (!company_id) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const query = `
      SELECT 
        eb.id AS booking_id,
        eb.event_id,
        ce.event_name,
        ce.event_thumbnail,
        eb.user_id,
        u.full_name AS user_name,
        u.email AS user_email,
        eb.event_price,
        eb.number_of_tickets,
        eb.total_amount,
        eb.status,
        eb.created_at
      FROM event_bookings eb
      JOIN users u ON eb.user_id = u.id
      JOIN company_events ce ON eb.event_id = ce.id
      WHERE eb.company_id = $1
      ORDER BY eb.created_at DESC
    `;

    const result = await pool.query(query, [company_id]);

    const bookings = result.rows.map(booking => ({
      ...booking,
      event_thumbnail: booking.event_thumbnail
        ? `${BASE_EVENT_IMAGE_URL}/${booking.event_thumbnail}`
        : null
    }));

    res.json({
      status: true,
      data: bookings
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

        eb.company_id,
        c.business_name,
        c.business_email,
        c.business_phone_number,

        eb.event_id,
        ce.event_name,
        ce.event_thumbnail,
        ce.start_date,
        ce.end_date,

        eb.event_price,
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
  let { search, type, location, price_type, accessibility_type, page = 1, limit = 20 } = req.body || {};

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
    FROM company_events e
    JOIN users u ON e.user_id = u.id
    WHERE e.is_deleted = FALSE
  `;

  if (search) {
    values.push(`%${search}%`);
    query += ` AND e.event_name ILIKE $${values.length}`;
  }

  // Convert to array if comma-separated string
  if (type) {
    const types = Array.isArray(type) ? type : type.split(',');
    values.push(types);
    query += ` AND e.event_types && $${values.length}::text[]`;
  }

  if (location) {
    values.push(`%${location}%`);
    query += ` AND e.event_address ILIKE $${values.length}`;
  }

  if (price_type) {
    values.push(price_type);
    query += ` AND e.price_type = $${values.length}`;
  }

  if (accessibility_type) {
    const accessTypes = Array.isArray(accessibility_type) ? accessibility_type : accessibility_type.split(',');
    values.push(accessTypes);
    query += ` AND e.accessibility_types && $${values.length}::text[]`;
  }

  query += ` ORDER BY e.start_date DESC`;

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
        business_overview: event.business_overview
      }
    }));

    res.json({ status: true, data: events });
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
//     event_price,
//     number_of_tickets,
//     total_amount,
//     attendee_info // 👈 should be an array of { name, email }
//   } = req.body;

//   if (!user_id || !event_id || !company_id || !number_of_tickets || !total_amount) {
//     return res.status(400).json({ status: false, error: 'Missing required fields' });
//   }
// console.log("Inserting booking for event_id:", event_id);
//   // Optional: Validate attendee_info length === number_of_tickets

// const eventCheck = await pool.query(
//   'SELECT id FROM company_events WHERE id = $1 AND user_id = $2',
//   [event_id, company_id]
// );

// if (eventCheck.rows.length === 0) {
//   return res.status(400).json({ status: false, error: 'Invalid event_id or event does not belong to the specified company.' });
// }

//   try {
//     const query = `
//       INSERT INTO event_bookings (
//         user_id, company_id, event_id, event_price, number_of_tickets,
//         total_amount, attendee_info
//       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
//     `;

//     const values = [
//       user_id,
//       company_id,
//       event_id,
//       event_price || null,
//       number_of_tickets,
//       total_amount,
//       JSON.stringify(attendee_info || [])
//     ];

//     await pool.query(query, values);

//     res.status(201).json({ status: true, message: 'Booking successful' });
//   } catch (err) {
//     console.error('Booking Error:', err.message);
//     res.status(500).json({ status: false, error: 'Internal server error' });
//   }
// };


exports.createEventBooking = async (req, res) => {
  const user_id = req.user?.userId;
  const {
    company_id,
    event_id,
    event_price,
    number_of_tickets,
    total_amount,
    attendee_info // [{ name, email }]
  } = req.body;

  // Basic validation
  if (!user_id || !event_id || !company_id || !number_of_tickets || !total_amount) {
    return res.status(400).json({ status: false, error: 'Missing required fields' });
  }

  // Optional: Validate number of attendees
  if (attendee_info && attendee_info.length !== number_of_tickets) {
    return res.status(400).json({ status: false, error: 'Attendee count mismatch with number_of_tickets' });
  }

  // Check if event exists and belongs to company
  const eventCheck = await pool.query(
    'SELECT id FROM company_events WHERE id = $1 AND user_id = $2',
    [event_id, company_id]
  );

  if (eventCheck.rows.length === 0) {
    return res.status(400).json({
      status: false,
      error: 'Invalid event_id or event does not belong to the specified company.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Insert into event_bookings with payment_status = pending
    const bookingInsertQuery = `
      INSERT INTO event_bookings (
        user_id, company_id, event_id, event_price, number_of_tickets,
        total_amount, attendee_info, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING id
    `;

    const bookingValues = [
      user_id,
      company_id,
      event_id,
      event_price || null,
      number_of_tickets,
      total_amount,
      JSON.stringify(attendee_info || [])
    ];

    const bookingResult = await client.query(bookingInsertQuery, bookingValues);
    const booking_id = bookingResult.rows[0].id;

    // 2. Create Stripe PaymentIntent (AUD)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total_amount * 100), // Convert to cents
      currency: 'aud',
      metadata: {
        booking_id: booking_id,
        user_id: user_id,
        event_id: event_id,
      },
    });

    // 3. Insert into transactions table
    await client.query(
      `INSERT INTO transactions (booking_id, user_id, event_id, payment_intent_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        booking_id,
        user_id,
        event_id,
        paymentIntent.id,
        total_amount,
        'aud',
        'pending'
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      status: true,
      message: 'Booking initiated. Complete payment to confirm.',
      clientSecret: paymentIntent.client_secret,
      bookingId: booking_id
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Booking Error:', err.message);
    return res.status(500).json({ status: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
};