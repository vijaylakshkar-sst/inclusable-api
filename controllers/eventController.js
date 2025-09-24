const pool = require('../dbconfig');

exports.getCategories = async (req, res) => {
  const userId = req.user && req.user.userId;

  try {
    let categories = [];

    if (userId) {
      try {
        // Check if user has preferred event types
        const prefRes = await pool.query(
          'SELECT preferred_event_types FROM ndis_information WHERE user_id = $1',
          [userId]
        );

        if (
          prefRes.rows.length > 0 &&
          Array.isArray(prefRes.rows[0].preferred_event_types) &&
          prefRes.rows[0].preferred_event_types.length > 0
        ) {
          // Return only user's preferred categories
          categories = prefRes.rows[0].preferred_event_types;
        } else {
          // No preferences found, get all categories
          const result = await pool.query(
            'SELECT DISTINCT UNNEST(category) AS category FROM events'
          );
          categories = result.rows.map(row => row.category);
        }
      } catch (prefErr) {
        console.error('Failed to fetch user preferences, falling back to all categories:', prefErr.message);
        // Fallback to all categories if preference query fails
        const result = await pool.query(
          'SELECT DISTINCT UNNEST(category) AS category FROM events'
        );
        categories = result.rows.map(row => row.category);
      }
    } else {
      // No user ID, return all categories
      const result = await pool.query(
        'SELECT DISTINCT UNNEST(category) AS category FROM events'
      );
      categories = result.rows.map(row => row.category);
    }

    res.json({status: true, data:categories});
  } catch (err) {
    console.error('Fetch categories error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};


// New code: Only return the requested category and its events
exports.getAllEventsByCategory = async (req, res) => {
  const { category } = req.query;
  if (!category) {
    return res.status(400).json({ error: 'Missing category parameter' });
  }
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        title, 
        description, 
        start_date, 
        end_date, 
        suburb, 
        postcode, 
        state, 
        latitude, 
        longitude, 
        category, 
        website, 
        image_url, 
        host
        FROM events
    WHERE start_date >= NOW()::timestamp AND $1 = ANY(category)
    `, [category]);

    // Only group under the requested category
    const grouped = {};
    grouped[category] = result.rows;
    res.json({status: true, data: grouped});
  } catch (err) {
    console.error('Fetch by category error:', err.message);
    res.status(500).json({ status: false, error: 'Internal Server Error' });
  }
};


exports.getPersonalizedEvents = async (req, res) => {

  const userId = req.user?.userId;

  // Optional chaining to handle unauthenticated access

  try {
    // If no token/user, return all events grouped (same as getAllEventsGrouped)
    if (!userId) {
      const result = await pool.query(`
        SELECT 
          id, 
          title, 
          description, 
          start_date, 
          end_date, 
          suburb, 
          postcode, 
          state, 
          latitude, 
          longitude, 
          category, 
          website, 
          image_url, 
          host
        FROM events
        WHERE start_date >= NOW()::timestamp
      `);

      const allEvents = result.rows;
      const grouped = {};

      allEvents.forEach(event => {
        if (Array.isArray(event.category)) {
          event.category.forEach(cat => {
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(event);
          });
        } else {
          if (!grouped['Uncategorized']) grouped['Uncategorized'] = [];
          grouped['Uncategorized'].push(event);
        }
      });

      return res.json({
        status: true,
        events: grouped,
        personalization: {
          hasPreferences: false,
          totalCategories: Object.keys(grouped).length,
          totalEvents: allEvents.length,
          message: "Sign in and complete onboarding to get personalized event recommendations."
        }
      });
    }

    // ========== Personalized Flow ==========
    const userPreferencesQuery = `
      SELECT preferred_event_types, primary_disability_type, support_requirements 
      FROM ndis_information 
      WHERE user_id = $1
    `;

    const userPreferencesResult = await pool.query(userPreferencesQuery, [userId]);

    let personalizedEvents = {};
    let hasPreferences = false;

    if (userPreferencesResult.rows.length > 0) {
      const userPrefs = userPreferencesResult.rows[0];
      hasPreferences = true;

      if (userPrefs.preferred_event_types && userPrefs.preferred_event_types.length > 0) {
        const preferredTypes = userPrefs.preferred_event_types;

        const eventsQuery = `
          SELECT 
            id, 
            title, 
            description, 
            start_date, 
            end_date, 
            suburb, 
            postcode, 
            state, 
            latitude, 
            longitude, 
            category, 
            website, 
            image_url, 
            host
          FROM events
          WHERE start_date >= NOW()::timestamp 
          AND category && $1
          ORDER BY start_date ASC
        `;

        const eventsResult = await pool.query(eventsQuery, [preferredTypes]);
        const events = eventsResult.rows;

        events.forEach(event => {
          if (Array.isArray(event.category)) {
            event.category.forEach(cat => {
              if (preferredTypes.includes(cat)) {
                if (!personalizedEvents[cat]) personalizedEvents[cat] = [];
                personalizedEvents[cat].push(event);
              }
            });
          }
        });
      }
    }

    if (!hasPreferences) {
      return res.json({
        status: true,
        data:{events: {},
        personalization: {
          hasPreferences: false,
          totalCategories: 0,
          totalEvents: 0,
          message: "Please complete your onboarding to get personalized event recommendations."
        }}
      });
    }

    const response = {
      events: personalizedEvents,
      personalization: {
        hasPreferences: hasPreferences,
        totalCategories: Object.keys(personalizedEvents).length,
        totalEvents: Object.values(personalizedEvents).reduce((sum, evts) => sum + evts.length, 0)
      }
    };

    res.json({ status: true, data:response});

  } catch (err) {
    console.error('Personalized events error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

