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


async function searchWithPerplexity(query, category, location, startDate) {
  try {
    const now = new Date();
    const currentDateTime = now.toISOString();

    let searchQuery = `Find 5-8 upcoming events related to "${query}"`;

    if (startDate) {
      const formattedStartDate = new Date(startDate).toISOString();
      searchQuery += ` Events should start from ${formattedStartDate} or later.`;
    } else {
      searchQuery += ` Events should start from ${currentDateTime} or later.`;
    }

    if (category && Array.isArray(category) && category.length > 0) {
      searchQuery += ` Focus on categories like: ${category.join(', ')}.`;
    }

    if (location) {
      searchQuery += ` Prioritize events near ${location.suburb || location.state || 'Australia'}.`;
    }

    searchQuery += `
Return ONLY valid JSON array. No text before/after.
Format:
[
  {
    "title": "Event Name",
    "description": "Brief description (80-120 chars)",
    "start_date": "2025-11-20T18:00:00",
    "end_date": "2025-11-20T22:00:00",
    "location": {
      "suburb": "Sydney",
      "state": "NSW",
      "postcode": "2000",
      "latitude": -33.8688,
      "longitude": 151.2093
    },
    "category": ["Community Event"],
    "website": "https://example.com"
  }
]

Omit image_url. Use null for missing data.
`;


    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: 'Return ONLY valid, complete JSON arrays. Never add text before/after. Omit image_url fields.'
          },
          {
            role: 'user',
            content: searchQuery
          }
        ],
        temperature: 0.2, // Lower for faster, more focused results
        max_tokens: 3000, // Reduced for faster response
        top_p: 0.9,
        return_citations: false,
        search_recency_filter: "month"
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000,
      }
    );

    const content = response.data.choices[0].message.content;
    return parsePerplexityResponse(content, query, startDate);
  } catch (err) {
    console.error('❌ Perplexity search failed:', err.message);
    return null;
  }
}


async function searchWithTimeout(query, category, location, startDate) {
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(null), 12000); // 12s timeout
  });

  const searchPromise = searchWithPerplexity(query, category, location, startDate);

  return Promise.race([searchPromise, timeoutPromise]);
}


function parsePerplexityResponse(content, originalQuery, startDate) {
  try {
    const now = new Date();
    const filterDate = startDate ? new Date(startDate) : now;

    let events = [];

    // ==============================
    // CATEGORY MAPPING LOGIC
    // ==============================
    const CATEGORY_MAP = [
      {
        keys: [
          "business", "startup", "entrepreneur", "networking", "conference",
          "summit", "b2b", "corporate", "professional", "commerce", "trade",
          "investor", "pitch", "venture", "ceo", "leadership", "executive",
          "industry", "boardroom", "seminar", "symposium", "forum", "panel",
          "breakfast", "luncheon", "mixer", "meetup", "connect", "collaborate"
        ],
        label: "Business Event"
      },
      {
        keys: [
          "class", "workshop", "training", "lesson", "course", "talk", "seminar",
          "lecture", "tutorial", "masterclass", "bootcamp", "webinar", "session",
          "educational", "learning", "teach", "instruction", "certification",
          "skillshare", "demonstration", "clinic", "academy", "school", "study",
          "coaching", "mentoring", "guided", "hands-on", "practical", "how-to"
        ],
        label: "Classes, Lessons, Workshops and Talks"
      },
      {
        keys: [
          "community", "volunteer", "local", "charity", "ngo", "nonprofit",
          "fundraiser", "awareness", "donation", "cause", "social", "outreach",
          "neighbourhood", "neighborhood", "civic", "public", "grassroots",
          "activism", "advocacy", "support", "help", "aid", "relief", "welfare",
          "humanitarian", "service", "giving", "benefit", "drive", "campaign"
        ],
        label: "Community Event"
      },
      {
        keys: [
          "concert", "music", "band", "performance", "opera", "gig", "theatre",
          "theater", "show", "live", "acoustic", "orchestra", "symphony", "recital",
          "musical", "play", "drama", "comedy", "standup", "stand-up", "improv",
          "cabaret", "revue", "showcase", "artist", "singer", "musician", "dj",
          "dance", "ballet", "jazz", "rock", "pop", "classical", "folk", "indie",
          "electronic", "hip-hop", "country", "blues", "soul", "entertainment",
          "stage", "venue", "touring", "headliner", "opening act"
        ],
        label: "Concert or Performance"
      },
      {
        keys: [
          "exhibition", "show", "expo", "display", "gallery", "museum", "art",
          "exhibit", "installation", "collection", "showcase", "presentation",
          "viewing", "retrospective", "biennale", "fair", "trade show", "convention",
          "demonstration", "unveiling", "launch", "premiere", "opening", "vernissage",
          "artist", "curator", "contemporary", "modern", "visual", "sculpture",
          "photography", "painting", "design", "creative", "culture"
        ],
        label: "Exhibition and Shows"
      },
      {
        keys: [
          "festival", "celebration", "parade", "party", "carnival", "fiesta",
          "gala", "ball", "jubilee", "anniversary", "commemoration", "observance",
          "holiday", "seasonal", "cultural", "heritage", "traditional", "festive",
          "gathering", "ceremony", "ritual", "fete", "revelry", "mardi gras",
          "street party", "block party", "themed", "costume", "masquerade",
          "new year", "christmas", "halloween", "easter", "independence", "national"
        ],
        label: "Festivals and Celebrations"
      },
      {
        keys: [
          "food", "wine", "dining", "beer", "tasting", "culinary", "restaurant",
          "chef", "cooking", "cuisine", "gourmet", "gastronomy", "foodie", "eat",
          "drink", "beverage", "cocktail", "spirits", "whisky", "whiskey", "gin",
          "craft beer", "brewery", "winery", "vineyard", "sommelier", "pairing",
          "menu", "degustation", "feast", "banquet", "supper", "brunch", "lunch",
          "dinner", "breakfast", "cafe", "coffee", "tea", "dessert", "baking",
          "barbecue", "bbq", "picnic", "potluck", "harvest", "farm-to-table"
        ],
        label: "Food and Wine"
      },
      {
        keys: [
          "market", "fair", "bazaar", "flea", "farmers", "craft", "artisan",
          "vendor", "stall", "marketplace", "trading", "retail", "shopping",
          "boutique", "pop-up", "night market", "weekend market", "christmas market",
          "vintage", "antique", "secondhand", "handmade", "homemade", "local produce",
          "fresh", "organic", "sustainable", "eco", "maker", "seller", "buy"
        ],
        label: "Markets"
      },
      {
        keys: [
          "sport", "game", "match", "tournament", "run", "marathon", "race",
          "competition", "championship", "league", "cup", "trophy", "playoff",
          "athletics", "track", "field", "swimming", "cycling", "triathlon",
          "football", "soccer", "rugby", "cricket", "tennis", "basketball",
          "netball", "hockey", "golf", "boxing", "wrestling", "mma", "fitness",
          "gym", "workout", "training", "endurance", "sprint", "relay", "fun run",
          "charity run", "walkathon", "swim", "bike", "surf", "skate", "climb",
          "adventure", "outdoor", "trail", "cross-country", "ironman", "ultra"
        ],
        label: "Sporting Events"
      }
    ];

    function detectCategories(input) {
      const text = Array.isArray(input)
        ? input.join(" ").toLowerCase()
        : String(input || "").toLowerCase();

      const matchedCategories = new Set();

      for (const { keys, label } of CATEGORY_MAP) {
        if (keys.some(k => text.includes(k))) {
          matchedCategories.add(label);
        }
      }

      // Always return at least one valid frontend category
      return matchedCategories.size > 0 ? [...matchedCategories] : ["Community Event"];
    }


    const CATEGORY_IMAGES = {
      "Business Event": [
        "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80",
        "https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&q=80",
        "https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&q=80",
        "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&q=80",
        "https://images.unsplash.com/photo-1556761175-b413da4baf72?w=800&q=80"
      ],
      "Classes, Lessons, Workshops and Talks": [
        "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&q=80",
        "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800&q=80",
        "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&q=80",
        "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&q=80",
        "https://images.unsplash.com/photo-1588072432836-e10032774350?w=800&q=80"
      ],
      "Community Event": [
        "https://images.unsplash.com/photo-1559027615-cd4628902d4a?w=800&q=80",
        "https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=800&q=80",
        "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&q=80",
        "https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?w=800&q=80",
        "https://images.unsplash.com/photo-1528605105345-5344ea20e269?w=800&q=80"
      ],
      "Concert or Performance": [
        "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&q=80",
        "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80",
        "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&q=80",
        "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=80",
        "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=800&q=80"
      ],
      "Exhibition and Shows": [
        "https://images.unsplash.com/photo-1531058020387-3be344556be6?w=800&q=80",
        "https://images.unsplash.com/photo-1564399579883-451a5d44ec08?w=800&q=80",
        "https://images.unsplash.com/photo-1499781350541-7783f6c6a0c8?w=800&q=80",
        "https://images.unsplash.com/photo-1578926078164-54a48a481066?w=800&q=80",
        "https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=800&q=80"
      ],
      "Festivals and Celebrations": [
        "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80",
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80",
        "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800&q=80",
        "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80",
        "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80"
      ],
      "Food and Wine": [
        "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80",
        "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80",
        "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80",
        "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800&q=80",
        "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=800&q=80"
      ],
      "Markets": [
        "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800&q=80",
        "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=800&q=80",
        "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80",
        "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80",
        "https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=800&q=80"
      ],
      "Sporting Events": [
        "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&q=80",
        "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=800&q=80",
        "https://images.unsplash.com/photo-1552667466-07770ae110d0?w=800&q=80",
        "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80",
        "https://images.unsplash.com/photo-1578574577315-3fbeb0cecdc2?w=800&q=80"
      ]
    };


    // Helper to get random image from category
    function getRandomImageForCategory(category) {
      const images = CATEGORY_IMAGES[category] || CATEGORY_IMAGES["Community Event"];
      return images[Math.floor(Math.random() * images.length)];
    }


    // ==============================
    // JSON EXTRACTION
    // ==============================
    let jsonMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (!jsonMatch) jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        events = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } catch (e) {
        console.warn("⚠️ JSON parse error, falling back:", e.message);
      }
    }

    if (!Array.isArray(events) || events.length === 0) {
      console.warn("⚠️ No valid structured events found, using text fallback.");
      events = [
        {
          id: "perplexity-1",
          title: `Events related to "${originalQuery}"`,
          description: content.slice(0, 400).replace(/```json|```|\[|\]/g, "").trim(),
          start_date: null,
          end_date: null,
          suburb: null,
          state: null,
          postcode: null,
          latitude: null,
          longitude: null,
          category: ["Community Event"],
          website: null,
          source: "perplexity",
          similarity: 0,
          distance_km: null
        }
      ];
    }

    // ==============================
    // LOCATION PARSING
    // ==============================
   

    const parseLocation = (loc) => {
      if (!loc) return { suburb: null, state: null, postcode: null, latitude: null, longitude: null };

      if (typeof loc === "object") {
        return {
          suburb: loc.suburb || loc.city || loc.venue || null,
          state: loc.state || null,
          postcode: loc.postcode || loc.postal_code || null,
          latitude: loc.latitude || loc.lat || null,
          longitude: loc.longitude || loc.lng || loc.lon || null
        };
      }

      const str = String(loc);

      // Try multiple patterns
      const patterns = [
        /([\w\s]+),?\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s*(\d{4})?/i,
        /([\w\s]+)\s+(\d{4})/,  // "Melbourne 3000"
        /([\w\s]+),\s*Australia/i,  // "Sydney, Australia"
      ];

      for (const pattern of patterns) {
        const match = str.match(pattern);
        if (match) {
          return {
            suburb: match[1]?.trim() || null,
            state: match[2]?.toUpperCase() || null,
            postcode: match[3] || null,
            latitude: null,
            longitude: null
          };
        }
      }

      // Fallback: treat entire string as suburb
      return {
        suburb: str.trim(),
        state: null,
        postcode: null,
        latitude: null,
        longitude: null
      };
    };

    // ==============================
    // FORMAT & NORMALIZE
    // ==============================
    const formattedEvents = events.map((event, index) => {
      const loc = parseLocation(event.location || event.address || event.place);



            // Detect categories first
      const categories = detectCategories([
        event.category,
        event.title,
        event.description
      ]);

    // ALWAYS use our reliable image library
      // Ignore any image_url from Perplexity as they're often fake
      const imageUrl = getRandomImageForCategory(categories[0]);


      return {
        id: event.id || `perplexity-${index + 1}`,
        title: event.title?.trim() || "Untitled Event",
        description: event.description?.trim() || "",
        start_date: event.start_date || event.date || null,
        end_date: event.end_date || null,
        suburb: loc.suburb,
        state: loc.state,
        postcode: loc.postcode,
        latitude: loc.latitude,
        longitude: loc.longitude,
        category: categories,
        image_url: imageUrl,
        website: event.website || event.url || null,
        source: "perplexity",
        similarity: 0,
        distance_km: null
      };
    });

    // ==============================
    // FILTER UPCOMING EVENTS
  

    const upcoming = formattedEvents.filter(ev => {
      if (!ev.start_date) return true;
      try {
        const eventDate = new Date(ev.start_date);
        // Keep if valid date and upcoming, OR if date is invalid (give benefit of doubt)
        return isNaN(eventDate.getTime()) || eventDate >= filterDate;
      } catch {
        return true; // Keep unparseable dates rather than rejecting
      }

    });
    console.log(`✅ Parsed ${upcoming.length} upcoming events from Perplexity`);
    return upcoming;
  } catch (err) {
    console.error("❌ Failed to parse Perplexity response:", err.message);
    console.log("Raw content preview:", content.slice(0, 400));
    return [];
  }
}

exports.semanticSearch = async (req, res) => {

  const { query, category, start_date, latitude, longitude, radius, page = 1, limit = 10 } = req.query;
  const userId = req.user?.userId;

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
    // ====================================
    // PARALLEL EXECUTION STARTS HERE
    // ====================================
    const hasSearchQuery = query && query.trim();
    let embedding = null;
    let perplexityPromise = null;

    // Start both operations in parallel ONLY if we have a search query
    if (hasSearchQuery) {
      // Start embedding generation
      const embeddingPromise = getEmbedding(query);

      // Start Perplexity search in parallel (with timeout)
      const locationInfo = latitude && longitude ? {
        suburb: req.query.suburb,
        state: req.query.state
      } : null;
      
      perplexityPromise = searchWithTimeout(query, category, locationInfo, start_date);

      // Wait for embedding to complete (usually fast)
      embedding = await embeddingPromise;

      if (!embedding) {
        console.error('Embedding generation failed');
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
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat * Math.PI / 180) * Math.cos(event.latitude * Math.PI / 180) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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


     if (result.rows.length === 0 || (embedding && result.rows[0]?.similarity > 0.15)) {
      // Database results are poor or empty
      
      if (perplexityPromise) {
        // We already started Perplexity search - just wait for it
        console.log('⏳ Waiting for Perplexity results (already in progress)...');
        const perplexityResults = await perplexityPromise;

        if (perplexityResults && perplexityResults.length > 0) {
          console.log(`✅ Perplexity returned ${perplexityResults.length} results`);
          return res.json({
            status: true,
            data: perplexityResults,
            source: 'perplexity',
            message: 'Events found from web search.',
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

      if (hasExactKeywordMatch) {
        finalResults = result.rows.filter(row => row.has_exact_keywords);
      } else if (bestSimilarity < 0.08) {
        finalResults = result.rows.filter(row => row.similarity < 0.08);
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
