const axios = require('axios');
require('dotenv').config();
const pool = require('../dbconfig');

function toPgVectorString(arr) {
  if (!Array.isArray(arr)) {
    throw new Error("Embedding must be an array");
  }

  if (arr.length !== 1536) {
    throw new Error(`Embedding must be of length 1536. Got ${arr.length}`);
  }

  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'number' || isNaN(arr[i])) {
      throw new Error(`Invalid number at index ${i}: ${arr[i]}`);
    }
  }

  return `[${arr.join(',')}]`;
}


// 🔁 Embedding generator
async function getEmbedding(query) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        model: 'text-embedding-ada-002',
        input: query,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    return response.data.data[0].embedding;
  } catch (err) {
    console.error('❌ Embedding generation failed:', err.message);
    return null;
  }
}

// Perplexity search fallback for upcoming events
async function searchWithPerplexity(query, category, location, startDate) {
  try {
    const now = new Date();
    const currentDateTime = now.toISOString();
    
    let searchQuery = `Find ONLY upcoming events (events that have not yet started or are currently happening) related to "${query}"`;
    
    if (startDate) {
      const formattedStartDate = new Date(startDate).toISOString();
      searchQuery += ` starting from ${formattedStartDate} or later`;
    } else {
      searchQuery += ` starting from ${currentDateTime} or later (including events happening later today)`;
    }
    
    if (category && Array.isArray(category) && category.length > 0) {
      searchQuery += ` in categories: ${category.join(', ')}`;
    }
    
    if (location) {
      searchQuery += ` near ${location.suburb || location.state || 'Australia'}`;
    } else {
      searchQuery += ` in Australia`;
    }
    
    searchQuery += `. IMPORTANT: Include events happening later today. Do NOT include events that have already ended. Provide event details including title, description, start date and time (in ISO format), location, and website if available.`;

    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant that finds upcoming event information. Current date and time is ${currentDateTime}. Return structured data ONLY about future/upcoming events (including events later today) in JSON format with fields: title, description, start_date (ISO format with time if available), location, website, category. Include events that haven't started yet, even if they are today.`
          },
          {
            role: 'user',
            content: searchQuery
          }
        ],
        temperature: 0.2,
        max_tokens: 2000
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.choices[0].message.content;
    
    // Parse the response and format it to match your database structure
    return parsePerplexityResponse(content, query, startDate);
  } catch (err) {
    console.error('❌ Perplexity search failed:', err.message);
    return null;
  }
}



// Parse Perplexity response to match database format
function parsePerplexityResponse(content, originalQuery, startDate) {
  try {
    const now = new Date(); // Current date AND time
    const filterDate = startDate ? new Date(startDate) : now;
    
    let events = [];
    
    // Try multiple JSON extraction methods
    // Method 1: Look for JSON array
    let jsonMatch = content.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    
    // Method 2: Look for code blocks with JSON
    if (!jsonMatch) {
      jsonMatch = content.match(/```(?:json)?\s*(\[\s*\{[\s\S]*?\}\s*\])\s*```/);
      if (jsonMatch) jsonMatch[0] = jsonMatch[1];
    }
    
    // Method 3: Extract everything between first [ and last ]
    if (!jsonMatch) {
      const firstBracket = content.indexOf('[');
      const lastBracket = content.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        jsonMatch = [content.substring(firstBracket, lastBracket + 1)];
      }
    }
    
    if (jsonMatch) {
      try {
        const jsonString = jsonMatch[0].trim();
        events = JSON.parse(jsonString);
        console.log('Successfully parsed JSON from Perplexity response');
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr.message);
        console.log('Attempted to parse:', jsonMatch[0].substring(0, 200));
      }
    }
    
    // If no valid JSON found or parsing failed, create a text-based response
    if (!Array.isArray(events) || events.length === 0) {
      console.log('No valid JSON array found, creating text-based response');
      events = [{
        id: 'perplexity-1',
        title: `Events related to "${originalQuery}"`,
        description: content.substring(0, 500).replace(/```json|```|\[|\]/g, '').trim(),
        start_date: null,
        end_date: null,
        suburb: null,
        state: null,
        postcode: null,
        latitude: null,
        longitude: null,
        category: ['General'],
        image_url: null,
        website: null,
        source: 'perplexity',
        similarity: 0,
        distance_km: null
      }];
    }

    // Format events and filter out past events
    const formattedEvents = events.map((event, index) => ({
      id: event.id || `perplexity-${index + 1}`,
      title: event.title || 'Event Information',
      description: event.description || '',
      start_date: event.start_date || event.date || null,
      end_date: event.end_date || null,
      suburb: event.suburb || event.location?.suburb || null,
      state: event.state || event.location?.state || null,
      postcode: event.postcode || event.location?.postcode || null,
      latitude: event.latitude || null,
      longitude: event.longitude || null,
      category: Array.isArray(event.category) ? event.category : [event.category || 'General'],
      image_url: event.image_url || null,
      website: event.website || event.url || null,
      source: 'perplexity',
      similarity: 0,
      distance_km: null
    }));

    // Filter out past events - only include upcoming events (considering time)
    const upcomingEvents = formattedEvents.filter(event => {
      if (!event.start_date) {
        // If no date, keep it (might be general info)
        return true;
      }
      
      try {
        const eventDate = new Date(event.start_date);
        // Compare with full datetime, not just date
        return eventDate >= filterDate;
      } catch (err) {
        console.error('Failed to parse event date:', event.start_date);
        return false;
      }
    });

    console.log(`Filtered ${formattedEvents.length} Perplexity events to ${upcomingEvents.length} upcoming events`);
    return upcomingEvents;
    
  } catch (err) {
    console.error('Failed to parse Perplexity response:', err.message);
    console.log('Raw content preview:', content.substring(0, 300));
    return [];
  }
}



// New code with pagination and perplexity fallback
exports.semanticSearch = async (req, res) => {

   const { query, category, start_date, latitude, longitude, radius, page = 1, limit = 10 } = req.query;
   const userId = req.user?.userId;

  // Remove the query validation - allow empty queries
  // if (!query) {
  //   return res.status(400).json({
  //     error: 'Missing query parameter',
  //     statusCode: 400
  //   });
  // }

  // Validate pagination parameters
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  
  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({
      error: 'Invalid page parameter. Must be a positive integer.',
      statusCode: 400
    });
  }
  
  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({
      error: 'Invalid limit parameter. Must be between 1 and 100.',
      statusCode: 400
    });
  }

  const offset = (pageNum - 1) * limitNum;

  try {
    // Only generate embedding if query is provided
    let embedding = null;
    if (query && query.trim()) {
      embedding = await getEmbedding(query);
      console.log(embedding, "embedding");

      if (!embedding) {
        return res.status(500).json({
          error: 'Embedding generation failed',
          statusCode: 500
        });
      }
    }

    // Get user preferences
    let hasPreferences = false;
    let preferredTypes = [];

    if (userId) {
      try {
        const userPreferencesResult = await pool.query(
          `SELECT preferred_event_types FROM ndis_information WHERE user_id = $1`,
          [userId]
        );
        if (
          userPreferencesResult.rows.length > 0 &&
          Array.isArray(userPreferencesResult.rows[0].preferred_event_types) &&
          userPreferencesResult.rows[0].preferred_event_types.length > 0
        ) {
          hasPreferences = true;
          preferredTypes = userPreferencesResult.rows[0].preferred_event_types;
        }
      } catch (prefErr) {
        console.error('Failed to read user preferences, falling back to all events:', prefErr.message);
      }
    }

    // Declare result variable outside the conditional blocks
    let result;
    let countResult;

    // Approach 1: Simple bounding box in SQL (most reliable)
    if (latitude && longitude && radius) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const radiusKm = parseFloat(radius);
      
      if (isNaN(lat) || isNaN(lng) || isNaN(radiusKm)) {
        return res.status(400).json({
          error: 'Invalid location parameters',
          statusCode: 400
        });
      }

      // Calculate bounding box (approximate)
      const latDelta = radiusKm / 111.0; // 1 degree lat ≈ 111 km
      const lngDelta = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));

      const minLat = lat - latDelta;
      const maxLat = lat + latDelta;
      const minLng = lng - lngDelta;
      const maxLng = lng + lngDelta;

      let sqlQuery;
      let countQuery;
      let queryParams;
      let countParams;

      if (category) {
        const categories = Array.isArray(category) ? category : [category];
        if (start_date) {
          // With category and date
          if (embedding) {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website,
                embedding <=> $1 AS similarity,
                CASE 
                  WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
                  THEN true ELSE false 
                END as has_exact_keywords
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND start_date >= $3
                AND category && $4
                AND latitude BETWEEN $5 AND $6
                AND longitude BETWEEN $7 AND $8
                AND embedding <=> $1 < 0.3
              ORDER BY has_exact_keywords DESC, similarity ASC
              LIMIT $9 OFFSET $10
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND start_date >= $3
                AND category && $4
                AND latitude BETWEEN $5 AND $6
                AND longitude BETWEEN $7 AND $8
                AND embedding <=> $1 < 0.3
            `;
            queryParams = [toPgVectorString(embedding), `%${query}%`, new Date(start_date), categories, minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [toPgVectorString(embedding), `%${query}%`, new Date(start_date), categories, minLat, maxLat, minLng, maxLng];
          } else {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website
              FROM events
              WHERE start_date > NOW()
                AND start_date >= $1
                AND category && $2
                AND latitude BETWEEN $3 AND $4
                AND longitude BETWEEN $5 AND $6
              ORDER BY start_date ASC
              LIMIT $7 OFFSET $8
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE start_date > NOW()
                AND start_date >= $1
                AND category && $2
                AND latitude BETWEEN $3 AND $4
                AND longitude BETWEEN $5 AND $6
            `;
            queryParams = [new Date(start_date), categories, minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [new Date(start_date), categories, minLat, maxLat, minLng, maxLng];
          }
        } else {
          // With category only
          if (embedding) {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website,
                embedding <=> $1 AS similarity,
                CASE 
                  WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
                  THEN true ELSE false 
                END as has_exact_keywords
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND category && $3
                AND latitude BETWEEN $4 AND $5
                AND longitude BETWEEN $6 AND $7
                AND embedding <=> $1 < 0.3
              ORDER BY has_exact_keywords DESC, similarity ASC
              LIMIT $8 OFFSET $9
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND category && $3
                AND latitude BETWEEN $4 AND $5
                AND longitude BETWEEN $6 AND $7
                AND embedding <=> $1 < 0.3
            `;
            queryParams = [toPgVectorString(embedding), `%${query}%`, categories, minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [toPgVectorString(embedding), `%${query}%`, categories, minLat, maxLat, minLng, maxLng];
          } else {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website
              FROM events
              WHERE start_date > NOW()
                AND category && $1
                AND latitude BETWEEN $2 AND $3
                AND longitude BETWEEN $4 AND $5
              ORDER BY start_date ASC
              LIMIT $6 OFFSET $7
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE start_date > NOW()
                AND category && $1
                AND latitude BETWEEN $2 AND $3
                AND longitude BETWEEN $4 AND $5
            `;
            queryParams = [categories, minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [categories, minLat, maxLat, minLng, maxLng];
          }
        }
      } else if (hasPreferences) {
        if (start_date) {
          // With preferences and date
          if (embedding) {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website,
                embedding <=> $1 AS similarity,
                CASE 
                  WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
                  THEN true ELSE false 
                END as has_exact_keywords
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND start_date >= $3
                AND category && $4
                AND latitude BETWEEN $5 AND $6
                AND longitude BETWEEN $7 AND $8
                AND embedding <=> $1 < 0.3
              ORDER BY has_exact_keywords DESC, similarity ASC
              LIMIT $9 OFFSET $10
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND start_date >= $3
                AND category && $4
                AND latitude BETWEEN $5 AND $6
                AND longitude BETWEEN $7 AND $8
                AND embedding <=> $1 < 0.3
            `;
            queryParams = [toPgVectorString(embedding), `%${query}%`, new Date(start_date), preferredTypes, minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [toPgVectorString(embedding), `%${query}%`, new Date(start_date), preferredTypes, minLat, maxLat, minLng, maxLng];
          } else {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website
              FROM events
              WHERE start_date > NOW()
                AND start_date >= $1
                AND category && $2
                AND latitude BETWEEN $3 AND $4
                AND longitude BETWEEN $5 AND $6
              ORDER BY start_date ASC
              LIMIT $7 OFFSET $8
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE start_date > NOW()
                AND start_date >= $1
                AND category && $2
                AND latitude BETWEEN $3 AND $4
                AND longitude BETWEEN $5 AND $6
            `;
            queryParams = [new Date(start_date), preferredTypes, minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [new Date(start_date), preferredTypes, minLat, maxLat, minLng, maxLng];
          }
        } else {
          // With preferences only
          if (embedding) {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website,
                embedding <=> $1 AS similarity,
                CASE 
                  WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
                  THEN true ELSE false 
                END as has_exact_keywords
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND category && $3
                AND latitude BETWEEN $4 AND $5
                AND longitude BETWEEN $6 AND $7
                AND embedding <=> $1 < 0.3
              ORDER BY has_exact_keywords DESC, similarity ASC
              LIMIT $8 OFFSET $9
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND category && $3
                AND latitude BETWEEN $4 AND $5
                AND longitude BETWEEN $6 AND $7
                AND embedding <=> $1 < 0.3
            `;
            queryParams = [toPgVectorString(embedding), `%${query}%`, preferredTypes, minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [toPgVectorString(embedding), `%${query}%`, preferredTypes, minLat, maxLat, minLng, maxLng];
          } else {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website
              FROM events
              WHERE start_date > NOW()
                AND category && $1
                AND latitude BETWEEN $2 AND $3
                AND longitude BETWEEN $4 AND $5
              ORDER BY start_date ASC
              LIMIT $6 OFFSET $7
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE start_date > NOW()
                AND category && $1
                AND latitude BETWEEN $2 AND $3
                AND longitude BETWEEN $4 AND $5
            `;
            queryParams = [preferredTypes, minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [preferredTypes, minLat, maxLat, minLng, maxLng];
          }
        }
      } else {
        if (start_date) {
          // With date only
          if (embedding) {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website,
                embedding <=> $1 AS similarity,
                CASE 
                  WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
                  THEN true ELSE false 
                END as has_exact_keywords
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND start_date >= $3
                AND latitude BETWEEN $4 AND $5
                AND longitude BETWEEN $6 AND $7
                AND embedding <=> $1 < 0.3
              ORDER BY has_exact_keywords DESC, similarity ASC
              LIMIT $8 OFFSET $9
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND start_date >= $3
                AND latitude BETWEEN $4 AND $5
                AND longitude BETWEEN $6 AND $7
                AND embedding <=> $1 < 0.3
            `;
            queryParams = [toPgVectorString(embedding), `%${query}%`, new Date(start_date), minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [toPgVectorString(embedding), `%${query}%`, new Date(start_date), minLat, maxLat, minLng, maxLng];
          } else {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website
              FROM events
              WHERE start_date > NOW()
                AND start_date >= $1
                AND latitude BETWEEN $2 AND $3
                AND longitude BETWEEN $4 AND $5
              ORDER BY start_date ASC
              LIMIT $6 OFFSET $7
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE start_date > NOW()
                AND start_date >= $1
                AND latitude BETWEEN $2 AND $3
                AND longitude BETWEEN $4 AND $5
            `;
            queryParams = [new Date(start_date), minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [new Date(start_date), minLat, maxLat, minLng, maxLng];
          }
        } else {
          // Location only
          if (embedding) {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website,
                embedding <=> $1 AS similarity,
                CASE 
                  WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
                  THEN true ELSE false 
                END as has_exact_keywords
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND latitude BETWEEN $3 AND $4
                AND longitude BETWEEN $5 AND $6
                AND embedding <=> $1 < 0.3
              ORDER BY has_exact_keywords DESC, similarity ASC
              LIMIT $7 OFFSET $8
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE embedding IS NOT NULL 
                AND start_date > NOW()
                AND latitude BETWEEN $3 AND $4
                AND longitude BETWEEN $5 AND $6
                AND embedding <=> $1 < 0.3
            `;
            queryParams = [toPgVectorString(embedding), `%${query}%`, minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [toPgVectorString(embedding), `%${query}%`, minLat, maxLat, minLng, maxLng];
          } else {
            sqlQuery = `
              SELECT 
                id, title, description, start_date, end_date, suburb, state, postcode,
                latitude, longitude, category, image_url, website
              FROM events
              WHERE start_date > NOW()
                AND latitude BETWEEN $1 AND $2
                AND longitude BETWEEN $3 AND $4
              ORDER BY start_date ASC
              LIMIT $5 OFFSET $6
            `;
            countQuery = `
              SELECT COUNT(*) as total
              FROM events
              WHERE start_date > NOW()
                AND latitude BETWEEN $1 AND $2
                AND longitude BETWEEN $3 AND $4
            `;
            queryParams = [minLat, maxLat, minLng, maxLng, limitNum, offset];
            countParams = [minLat, maxLat, minLng, maxLng];
          }
        }
      }

      console.log('Executing location query with', queryParams.length, 'parameters');
      result = await pool.query(sqlQuery, queryParams);
      countResult = await pool.query(countQuery, countParams);

      // Calculate precise distances and filter (only if we have location data)
      const eventsWithDistance = result.rows.map(event => {
        const R = 6371; // Earth radius in km
        const dLat = (event.latitude - lat) * Math.PI / 180;
        const dLng = (event.longitude - lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                 Math.cos(lat * Math.PI / 180) * Math.cos(event.latitude * Math.PI / 180) * 
                 Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c;
        
        return {
          ...event,
          distance_km: Math.round(distance * 10) / 10
        };
      }).filter(event => event.distance_km <= radiusKm);

      // Sort by distance within similarity groups (only if embedding exists)
      if (embedding) {
        eventsWithDistance.sort((a, b) => {
          if (a.has_exact_keywords !== b.has_exact_keywords) {
            return b.has_exact_keywords - a.has_exact_keywords;
          }
          if (Math.abs(a.similarity - b.similarity) > 0.01) {
            return a.similarity - b.similarity;
          }
          return a.distance_km - b.distance_km;
        });
      } else {
        // Sort by start_date and distance when no embedding
        eventsWithDistance.sort((a, b) => {
          const dateCompare = new Date(a.start_date) - new Date(b.start_date);
          if (dateCompare !== 0) return dateCompare;
          return a.distance_km - b.distance_km;
        });
      }

      result.rows = eventsWithDistance;

    } else {
      // No location filter - original logic
      let sqlQuery;
      let countQuery;
      let queryParams;
      let countParams;

      if (embedding) {
        sqlQuery = `
          SELECT 
            id, title, description, start_date, end_date, suburb, state, postcode,
            latitude, longitude, category, image_url, website,
            embedding <=> $1 AS similarity,
            CASE 
              WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
              THEN true ELSE false 
            END as has_exact_keywords
          FROM events
          WHERE embedding IS NOT NULL 
            AND start_date > NOW()
            AND embedding <=> $1 < 0.3
        `;

        countQuery = `
          SELECT COUNT(*) as total
          FROM events
          WHERE embedding IS NOT NULL 
            AND start_date > NOW()
            AND embedding <=> $1 < 0.3
        `;

        queryParams = [toPgVectorString(embedding), `%${query}%`];
        countParams = [toPgVectorString(embedding)];
      } else {
        sqlQuery = `
          SELECT 
            id, title, description, start_date, end_date, suburb, state, postcode,
            latitude, longitude, category, image_url, website
          FROM events
          WHERE start_date > NOW()
        `;

        countQuery = `
          SELECT COUNT(*) as total
          FROM events
          WHERE start_date > NOW()
        `;

        queryParams = [];
        countParams = [];
      }

      if (category) {
        const categories = Array.isArray(category) ? category : [category];
        const paramIndex = queryParams.length + 1;
        const countParamIndex = countParams.length + 1;
        sqlQuery += ` AND category && $${paramIndex}`;
        countQuery += ` AND category && $${countParamIndex}`;
        queryParams.push(categories);
        countParams.push(categories);
      } else if (hasPreferences) {
        const paramIndex = queryParams.length + 1;
        const countParamIndex = countParams.length + 1;
        sqlQuery += ` AND category && $${paramIndex}`;
        countQuery += ` AND category && $${countParamIndex}`;
        queryParams.push(preferredTypes);
        countParams.push(preferredTypes);
      }

      if (start_date) {
        const paramIndex = queryParams.length + 1;
        const countParamIndex = countParams.length + 1;
        sqlQuery += ` AND start_date >= $${paramIndex}`;
        countQuery += ` AND start_date >= $${countParamIndex}`;
        queryParams.push(new Date(start_date));
        countParams.push(new Date(start_date));
      }

      if (embedding) {
        sqlQuery += ` ORDER BY has_exact_keywords DESC, similarity ASC`;
      } else {
        sqlQuery += ` ORDER BY start_date ASC`;
      }

      sqlQuery += ` LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
      queryParams.push(limitNum, offset);

      console.log('Executing non-location query with', queryParams.length, 'parameters');
      result = await pool.query(sqlQuery, queryParams);
      countResult = await pool.query(countQuery, countParams);
      
      // Add null distance for consistency
      result.rows.forEach(row => {
        row.distance_km = null;
      });
    }

    const totalCount = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(totalCount / limitNum);

    if (result.rows.length === 0) {
      // Only use Perplexity fallback if a search query was provided
      if (query && query.trim()) {
        console.log('No results found in database. Attempting Perplexity fallback...');
        
        const locationInfo = latitude && longitude ? { 
          suburb: req.query.suburb, 
          state: req.query.state 
        } : null;
        
        const perplexityResults = await searchWithPerplexity(query, category, locationInfo, start_date);
        
        if (perplexityResults && perplexityResults.length > 0) {
          console.log(`Perplexity returned ${perplexityResults.length} upcoming results`);
          return res.json({
            status: true,
            data: perplexityResults,
            source: 'perplexity',
            message: 'No matching events found in our database. Here are upcoming events from web search.',
            pagination: {
              page: pageNum,
              totalPages: 1,
              total: perplexityResults.length,
              limit: perplexityResults.length,
              hasNextPage: false,
              hasPreviousPage: false
            }
          });
        }
      }
      
      // If no query or Perplexity also fails
      return res.status(404).json({
        error: 'No upcoming events found',
        statusCode: 404,
        message: 'No upcoming events match your search. Try different keywords or check back later for new events.'
      });
    }

    // Apply improved filtering logic (only if embedding exists)
    let finalResults = result.rows;
    
    if (embedding) {
      const bestSimilarity = result.rows[0].similarity;
      const hasExactKeywordMatch = result.rows.some(row => row.has_exact_keywords);

      const isVeryExactSemantic = bestSimilarity < 0.05;

      // Filter logic remains but applies to current page only
      if (hasExactKeywordMatch) {
        console.log(`Exact keyword match found. Prioritizing keyword matches.`);
        const keywordMatches = result.rows.filter(row => row.has_exact_keywords);
        finalResults = keywordMatches;
        
        if (finalResults.length < limitNum && isVeryExactSemantic) {
          const additionalResults = result.rows
            .filter(row => !row.has_exact_keywords && row.similarity < 0.08)
            .slice(0, limitNum - finalResults.length);
          finalResults = [...finalResults, ...additionalResults];
        }
      } else if (isVeryExactSemantic) {
        console.log(`Exact semantic match detected (similarity: ${bestSimilarity}). Showing only exact matches.`);
        finalResults = result.rows.filter(row => row.similarity < 0.08);
      } else if (pageNum === 1) {
        // Only use Perplexity fallback on first page with weak matches
        console.log(`No exact keyword matches found and semantic similarity not strong enough. Trying Perplexity...`);
        
        const locationInfo = latitude && longitude ? { 
          suburb: req.query.suburb, 
          state: req.query.state 
        } : null;
        
        const perplexityResults = await searchWithPerplexity(query, category, locationInfo, start_date);
        
        if (perplexityResults && perplexityResults.length > 0) {
          console.log(`Perplexity returned ${perplexityResults.length} upcoming results`);
          return res.json({
            status: true,
            data: perplexityResults,
            source: 'perplexity',
            message: 'No matching events found in our database. Here are upcoming events from web search.',
            pagination: {
              page: pageNum,
              totalPages: 1,
              total: perplexityResults.length,
              limit: perplexityResults.length,
              hasNextPage: false,
              hasPreviousPage: false
            }
          });
        }
        
        return res.status(404).json({
          error: 'No upcoming events found',
          statusCode: 404,
          message: 'No upcoming events match your search. Try different keywords or check back later for new events.'
        });
      }

      // Only return results if we have meaningful matches
      if (finalResults.length === 0 && pageNum === 1) {
        console.log('Final results empty after filtering. Trying Perplexity...');
        
        const locationInfo = latitude && longitude ? { 
          suburb: req.query.suburb, 
          state: req.query.state 
        } : null;
        
        const perplexityResults = await searchWithPerplexity(query, category, locationInfo, start_date);
        
        if (perplexityResults && perplexityResults.length > 0) {
          console.log(`Perplexity returned ${perplexityResults.length} upcoming results`);
          return res.json({
            status: true,
            data: perplexityResults,
            source: 'perplexity',
            message: 'No matching events found in our database. Here are upcoming events from web search.',
            pagination: {
              page: pageNum,
              totalPages: 1,
              total: perplexityResults.length,
              limit: perplexityResults.length,
              hasNextPage: false,
              hasPreviousPage: false
            }
          });
        }
        
        return res.status(404).json({
          error: 'No upcoming events found',
          statusCode: 404,
          message: 'No upcoming events match your search. Try different keywords or check back later for new events.'
        });
      }
    }

    console.log(`Found ${totalCount} total results, returning page ${pageNum} with ${finalResults.length} results`);
    
    res.json({
      status: true,
      data: finalResults,
      pagination: {
        page: pageNum,
        totalPages: totalPages,
        total: totalCount,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPreviousPage: pageNum > 1
      }
    });   

  } catch (err) {
    console.error('❌ Semantic search error:', err.message); 
    res.status(500).json({ error: 'Internal Server Error' });
  }
};