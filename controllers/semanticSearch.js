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


// exports.semanticSearch = async (req, res) => {

//   const { query, category, start_date, latitude, longitude, radius } = req.query;
//   const userId = req.user?.userId;

//   if (!query) {
//     return res.status(400).json({
//       status: false,
//       error: 'Missing query parameter',
//       statusCode: 400
//     });
//   }

//   try {
//     const embedding = await getEmbedding(query);
//     console.log(embedding, "embedding");

//     if (!embedding) {
//       return res.status(500).json({
//         status: false,
//         error: 'Embedding generation failed',
//         statusCode: 500
//       });
//     }

//     // Get user preferences
//     let hasPreferences = false;
//     let preferredTypes = [];

//     if (userId) {
//       try {
//         const userPreferencesResult = await pool.query(
//           `SELECT preferred_event_types FROM ndis_information WHERE user_id = $1`,
//           [userId]
//         );
//         if (
//           userPreferencesResult.rows.length > 0 &&
//           Array.isArray(userPreferencesResult.rows[0].preferred_event_types) &&
//           userPreferencesResult.rows[0].preferred_event_types.length > 0
//         ) {
//           hasPreferences = true;
//           preferredTypes = userPreferencesResult.rows[0].preferred_event_types;
//         }
//       } catch (prefErr) {
//         console.error('Failed to read user preferences, falling back to all events:', prefErr.message);
//       }
//     }

//     // Declare result variable outside the conditional blocks
//     let result;

//     // Approach 1: Simple bounding box in SQL (most reliable)
//     if (latitude && longitude && radius) {
//       const lat = parseFloat(latitude);
//       const lng = parseFloat(longitude);
//       const radiusKm = parseFloat(radius);

//       if (isNaN(lat) || isNaN(lng) || isNaN(radiusKm)) {
//         return res.status(400).json({
//           error: 'Invalid location parameters',
//           statusCode: 400
//         });
//       }

//       // Calculate bounding box (approximate)
//       const latDelta = radiusKm / 111.0; // 1 degree lat ≈ 111 km
//       const lngDelta = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));

//       const minLat = lat - latDelta;
//       const maxLat = lat + latDelta;
//       const minLng = lng - lngDelta;
//       const maxLng = lng + lngDelta;

//       let sqlQuery;
//       let queryParams;

//       if (category) {
//         const categories = Array.isArray(category) ? category : [category];
//         if (start_date) {
//           // With category and date
//           sqlQuery = `
//             SELECT 
//               id, title, description, start_date, end_date, suburb, state, postcode,
//               latitude, longitude, category, image_url, website,
//               embedding <=> $1 AS similarity,
//               CASE 
//                 WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
//                 THEN true ELSE false 
//               END as has_exact_keywords
//             FROM events
//             WHERE embedding IS NOT NULL 
//               AND start_date > NOW()
//               AND start_date >= $3
//               AND category && $4
//               AND latitude BETWEEN $5 AND $6
//               AND longitude BETWEEN $7 AND $8
//               AND embedding <=> $1 < 0.3
//             ORDER BY has_exact_keywords DESC, similarity ASC
//             LIMIT 50
//           `;
//           queryParams = [toPgVectorString(embedding), `%${query}%`, new Date(start_date), categories, minLat, maxLat, minLng, maxLng];
//         } else {
//           // With category only
//           sqlQuery = `
//             SELECT 
//               id, title, description, start_date, end_date, suburb, state, postcode,
//               latitude, longitude, category, image_url, website,
//               embedding <=> $1 AS similarity,
//               CASE 
//                 WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
//                 THEN true ELSE false 
//               END as has_exact_keywords
//             FROM events
//             WHERE embedding IS NOT NULL 
//               AND start_date > NOW()
//               AND category && $3
//               AND latitude BETWEEN $4 AND $5
//               AND longitude BETWEEN $6 AND $7
//               AND embedding <=> $1 < 0.3
//             ORDER BY has_exact_keywords DESC, similarity ASC
//             LIMIT 50
//           `;
//           queryParams = [toPgVectorString(embedding), `%${query}%`, categories, minLat, maxLat, minLng, maxLng];
//         }
//       } else if (hasPreferences) {
//         if (start_date) {
//           // With preferences and date
//           sqlQuery = `
//             SELECT 
//               id, title, description, start_date, end_date, suburb, state, postcode,
//               latitude, longitude, category, image_url, website,
//               embedding <=> $1 AS similarity,
//               CASE 
//                 WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
//                 THEN true ELSE false 
//               END as has_exact_keywords
//             FROM events
//             WHERE embedding IS NOT NULL 
//               AND start_date > NOW()
//               AND start_date >= $3
//               AND category && $4
//               AND latitude BETWEEN $5 AND $6
//               AND longitude BETWEEN $7 AND $8
//               AND embedding <=> $1 < 0.3
//             ORDER BY has_exact_keywords DESC, similarity ASC
//             LIMIT 50
//           `;
//           queryParams = [toPgVectorString(embedding), `%${query}%`, new Date(start_date), preferredTypes, minLat, maxLat, minLng, maxLng];
//         } else {
//           // With preferences only
//           sqlQuery = `
//             SELECT 
//               id, title, description, start_date, end_date, suburb, state, postcode,
//               latitude, longitude, category, image_url, website,
//               embedding <=> $1 AS similarity,
//               CASE 
//                 WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
//                 THEN true ELSE false 
//               END as has_exact_keywords
//             FROM events
//             WHERE embedding IS NOT NULL 
//               AND start_date > NOW()
//               AND category && $3
//               AND latitude BETWEEN $4 AND $5
//               AND longitude BETWEEN $6 AND $7
//               AND embedding <=> $1 < 0.3
//             ORDER BY has_exact_keywords DESC, similarity ASC
//             LIMIT 50
//           `;
//           queryParams = [toPgVectorString(embedding), `%${query}%`, preferredTypes, minLat, maxLat, minLng, maxLng];
//         }
//       } else {
//         if (start_date) {
//           // With date only
//           sqlQuery = `
//             SELECT 
//               id, title, description, start_date, end_date, suburb, state, postcode,
//               latitude, longitude, category, image_url, website,
//               embedding <=> $1 AS similarity,
//               CASE 
//                 WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
//                 THEN true ELSE false 
//               END as has_exact_keywords
//             FROM events
//             WHERE embedding IS NOT NULL 
//               AND start_date > NOW()
//               AND start_date >= $3
//               AND latitude BETWEEN $4 AND $5
//               AND longitude BETWEEN $6 AND $7
//               AND embedding <=> $1 < 0.3
//             ORDER BY has_exact_keywords DESC, similarity ASC
//             LIMIT 50
//           `;
//           queryParams = [toPgVectorString(embedding), `%${query}%`, new Date(start_date), minLat, maxLat, minLng, maxLng];
//         } else {
//           // Location only
//           sqlQuery = `
//             SELECT 
//               id, title, description, start_date, end_date, suburb, state, postcode,
//               latitude, longitude, category, image_url, website,
//               embedding <=> $1 AS similarity,
//               CASE 
//                 WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
//                 THEN true ELSE false 
//               END as has_exact_keywords
//             FROM events
//             WHERE embedding IS NOT NULL 
//               AND start_date > NOW()
//               AND latitude BETWEEN $3 AND $4
//               AND longitude BETWEEN $5 AND $6
//               AND embedding <=> $1 < 0.3
//             ORDER BY has_exact_keywords DESC, similarity ASC
//             LIMIT 50
//           `;
//           queryParams = [toPgVectorString(embedding), `%${query}%`, minLat, maxLat, minLng, maxLng];
//         }
//       }

//       result = await pool.query(sqlQuery, queryParams);

//       // Calculate precise distances and filter
//       const eventsWithDistance = result.rows.map(event => {
//         const R = 6371; // Earth radius in km
//         const dLat = (event.latitude - lat) * Math.PI / 180;
//         const dLng = (event.longitude - lng) * Math.PI / 180;
//         const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
//           Math.cos(lat * Math.PI / 180) * Math.cos(event.latitude * Math.PI / 180) *
//           Math.sin(dLng / 2) * Math.sin(dLng / 2);
//         const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
//         const distance = R * c;

//         return {
//           ...event,
//           distance_km: Math.round(distance * 10) / 10
//         };
//       }).filter(event => event.distance_km <= radiusKm);

//       // Sort by distance within similarity groups
//       eventsWithDistance.sort((a, b) => {
//         if (a.has_exact_keywords !== b.has_exact_keywords) {
//           return b.has_exact_keywords - a.has_exact_keywords;
//         }
//         if (Math.abs(a.similarity - b.similarity) > 0.01) {
//           return a.similarity - b.similarity;
//         }
//         return a.distance_km - b.distance_km;
//       });

//       result.rows = eventsWithDistance;

//     } else {
//       // No location filter - original logic
//       let sqlQuery = `
//         SELECT 
//           id, title, description, start_date, end_date, suburb, state, postcode,
//           latitude, longitude, category, image_url, website,
//           embedding <=> $1 AS similarity,
//           CASE 
//             WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
//             THEN true ELSE false 
//           END as has_exact_keywords
//         FROM events
//         WHERE embedding IS NOT NULL 
//           AND start_date > NOW()
//           AND embedding <=> $1 < 0.3
//       `;

//       let queryParams = [toPgVectorString(embedding), `%${query}%`];

//       if (category) {
//         const categories = Array.isArray(category) ? category : [category];
//         sqlQuery += ` AND category && $3`;
//         queryParams.push(categories);
//       } else if (hasPreferences) {
//         sqlQuery += ` AND category && $3`;
//         queryParams.push(preferredTypes);
//       }

//       if (start_date) {
//         const paramIndex = queryParams.length + 1;
//         sqlQuery += ` AND start_date >= $${paramIndex}`;
//         queryParams.push(new Date(start_date));
//       }

//       sqlQuery += ` ORDER BY has_exact_keywords DESC, similarity ASC LIMIT 50`;

//       result = await pool.query(sqlQuery, queryParams);

//       // Add null distance for consistency
//       result.rows.forEach(row => {
//         row.distance_km = null;
//       });
//     }


//     if (result.rows.length === 0) {
//       return res.status(404).json({
//         status: false,
//         error: 'No similar events found',
//       });
//     }

//     // Apply improved filtering logic
//     const bestSimilarity = result.rows[0].similarity;
//     const hasExactKeywordMatch = result.rows.some(row => row.has_exact_keywords);
//     let finalResults = [];

//     const isVeryExactSemantic = bestSimilarity < 0.05;

//     if (hasExactKeywordMatch) {
//       console.log(`Exact keyword match found. Prioritizing keyword matches.`);
//       const keywordMatches = result.rows.filter(row => row.has_exact_keywords);
//       //finalResults = keywordMatches.slice(0, 3);
//       finalResults = keywordMatches;

//       if (finalResults.length < 5 && isVeryExactSemantic) {
//         const additionalResults = result.rows
//           .filter(row => !row.has_exact_keywords && row.similarity < 0.08)
//           .slice(0, 5 - finalResults.length);
//         finalResults = [...finalResults, ...additionalResults];
//       }
//     } else if (isVeryExactSemantic) {
//       console.log(`Exact semantic match detected (similarity: ${bestSimilarity}). Showing only exact matches.`);
//       finalResults = result.rows.filter(row => row.similarity < 0.08);
//       // finalResults = finalResults.slice(0, 5);
//     } else {
//       // NEW LOGIC: Don't return results if no exact keyword matches found
//       console.log(`No exact keyword matches found and semantic similarity not strong enough. No results returned.`);
//       return res.status(404).json({
//         status: false,
//         error: 'No events found matching your search query',
//         statusCode: 404,
//         message: 'Try searching with different keywords or check your spelling'
//       });
//     }

//     // Only return results if we have meaningful matches
//     if (finalResults.length === 0) {
//       return res.status(404).json({
//         status: false,
//         error: 'No relevant events found for your search',
//         statusCode: 404
//       });
//     }

//     console.log(`Found ${result.rows.length} total results, returning ${finalResults.length} high-quality matches`);
//     res.json({ status: true, data: finalResults });

//   } catch (err) {
//     console.error('❌ Semantic search error:', err.message);
//     res.status(500).json({ status: false, error: 'Internal Server Error' });
//   }
// };
exports.semanticSearch = async (req, res) => {
  const {
    query,
    category,
    start_date,
    latitude,
    longitude,
    radius,
    page = 1,
    limit = 50,
  } = req.query;

  const userId = req.user?.userId;

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (safePage - 1) * safeLimit;

  let embedding = [];
  const hasQuery = query && query.trim();

  if (hasQuery) {
    embedding = await getEmbedding(query);
    console.log(embedding, "embedding");

    if (!embedding) {
      return res.status(500).json({
        status: false,
        error: "Embedding generation failed",
        statusCode: 500,
      });
    }
  } else {
    console.log("No query provided — skipping embedding generation.");
  }

  try {
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
        console.error("Failed to read user preferences:", prefErr.message);
      }
    }

    let result;

    // 🧭 LOCATION FILTER
    if (latitude && longitude && radius) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const radiusKm = parseFloat(radius);

      if (isNaN(lat) || isNaN(lng) || isNaN(radiusKm)) {
        return res.status(400).json({ error: "Invalid location parameters" });
      }

      const latDelta = radiusKm / 111.0;
      const lngDelta = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));
      const minLat = lat - latDelta;
      const maxLat = lat + latDelta;
      const minLng = lng - lngDelta;
      const maxLng = lng + lngDelta;

      // ---- Dynamic SQL Start ----
      let sqlQuery = `
        SELECT 
          id, title, description, start_date, end_date, suburb, state, postcode,
          latitude, longitude, category, image_url, website
      `;

      if (hasQuery) {
        sqlQuery += `,
          embedding <=> $1 AS similarity,
          CASE 
            WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
            THEN true ELSE false 
          END as has_exact_keywords
        `;
      }

      sqlQuery += ` FROM events WHERE start_date > NOW()`;

      // Base query params
      let queryParams = [];
      let paramIndex = 1;

      if (hasQuery) {
        queryParams.push(toPgVectorString(embedding), `%${query}%`);
        paramIndex = 3;
      }

      if (category) {
        const categories = Array.isArray(category) ? category : [category];
        sqlQuery += ` AND category && $${paramIndex++}`;
        queryParams.push(categories);
      } else if (hasPreferences) {
        sqlQuery += ` AND category && $${paramIndex++}`;
        queryParams.push(preferredTypes);
      }

      if (start_date) {
        sqlQuery += ` AND start_date >= $${paramIndex++}`;
        queryParams.push(new Date(start_date));
      }

      sqlQuery += `
        AND latitude BETWEEN $${paramIndex++} AND $${paramIndex++}
        AND longitude BETWEEN $${paramIndex++} AND $${paramIndex++}
      `;
      queryParams.push(minLat, maxLat, minLng, maxLng);

      if (hasQuery) sqlQuery += ` AND embedding <=> $1 < 0.3`;

      // 🧮 Count total
      const countQuery = `SELECT COUNT(*) AS total FROM (${sqlQuery}) AS sub`;
      const totalRes = await pool.query(countQuery, queryParams);
      const total = parseInt(totalRes.rows[0].total, 10);

      // 🧭 Pagination
      sqlQuery += hasQuery
        ? ` ORDER BY has_exact_keywords DESC, similarity ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`
        : ` ORDER BY start_date ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      queryParams.push(safeLimit, offset);

      // ---- Dynamic SQL End ----
      result = await pool.query(sqlQuery, queryParams);

      // Compute distance
      const eventsWithDistance = result.rows
        .map((event) => {
          const R = 6371;
          const dLat = (event.latitude - lat) * Math.PI / 180;
          const dLng = (event.longitude - lng) * Math.PI / 180;
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat * Math.PI / 180) *
              Math.cos(event.latitude * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = R * c;
          return { ...event, distance_km: Math.round(distance * 10) / 10 };
        })
        .filter((e) => e.distance_km <= radiusKm);

      result.rows = eventsWithDistance;

      return res.json({
        status: true,
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit),
        },
        data: result.rows,
      });
    } else {
      // 🧠 NO LOCATION FILTER
      let sqlQuery = `
        SELECT 
          id, title, description, start_date, end_date, suburb, state, postcode,
          latitude, longitude, category, image_url, website
      `;

      if (hasQuery) {
        sqlQuery += `,
          embedding <=> $1 AS similarity,
          CASE 
            WHEN LOWER(title) ILIKE LOWER($2) OR LOWER(description) ILIKE LOWER($2) 
            THEN true ELSE false 
          END as has_exact_keywords
        `;
      }

      sqlQuery += ` FROM events WHERE start_date > NOW()`;
      let queryParams = [];
      let paramIndex = 1;

      if (hasQuery) {
        queryParams.push(toPgVectorString(embedding), `%${query}%`);
        paramIndex = 3;
      }

      if (category) {
        const categories = Array.isArray(category) ? category : [category];
        sqlQuery += ` AND category && $${paramIndex++}`;
        queryParams.push(categories);
      } else if (hasPreferences) {
        sqlQuery += ` AND category && $${paramIndex++}`;
        queryParams.push(preferredTypes);
      }

      if (start_date) {
        sqlQuery += ` AND start_date >= $${paramIndex++}`;
        queryParams.push(new Date(start_date));
      }

      if (hasQuery) sqlQuery += ` AND embedding <=> $1 < 0.3`;

      // 🧮 Count total
      const countQuery = `SELECT COUNT(*) AS total FROM (${sqlQuery}) AS sub`;
      const totalRes = await pool.query(countQuery, queryParams);
      const total = parseInt(totalRes.rows[0].total, 10);

      sqlQuery += hasQuery
        ? ` ORDER BY has_exact_keywords DESC, similarity ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`
        : ` ORDER BY start_date ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      queryParams.push(safeLimit, offset);

      result = await pool.query(sqlQuery, queryParams);
      result.rows.forEach((row) => (row.distance_km = null));

      return res.json({
        status: true,
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit),
        },
        data: result.rows,
      });
    }
  } catch (err) {
    console.error("❌ Semantic search error:", err.message);
    res.status(500).json({ status: false, error: "Internal Server Error" });
  }
};
