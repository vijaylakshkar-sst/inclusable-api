const axios = require('axios');
const crypto = require('crypto');
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

// near the top of controllers/semanticSearch.js
// function hasRealTime(dateStr) {
//   if (!dateStr) return false;
//   const d = new Date(dateStr);
//   // treat midnight as "no time specified"
//   return !(
//     d.getUTCHours() === 0 &&
//     d.getUTCMinutes() === 0 &&
//     d.getUTCSeconds() === 0
//   );
// }


function sanitizeNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeEventDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function buildEmbeddingText(event) {
  const segments = [
    event.title,
    event.description,
    Array.isArray(event.category) ? event.category.join(' ') : event.category,
    event.suburb,
    event.state,
    event.website
  ].filter(Boolean);

  if (!segments.length) {
    return null;
  }

  const combined = segments.join(' | ');
  return combined.length > 8000 ? combined.slice(0, 8000) : combined;
}

function generateDeterministicEventId(event, fallbackIndex = 0) {
  const parts = [
    event.id,
    event.title,
    event.start_date,
    event.suburb,
    event.state,
    event.website
  ].filter(Boolean).join('|').toLowerCase();

  const baseString = parts || `perplexity-${fallbackIndex}-${Date.now()}`;
  const hash = crypto.createHash('sha1').update(baseString).digest('hex');
  return `perplexity-${hash.slice(0, 32)}`;
}

// Shared constants for Australia filtering
const AUSTRALIAN_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const NON_AUSTRALIAN_CITIES = ['zurich', 'london', 'paris', 'new york', 'tokyo', 'berlin', 'madrid', 'rome', 'amsterdam', 'vienna', 'stockholm', 'oslo', 'copenhagen', 'helsinki', 'dublin', 'brussels', 'lisbon', 'athens', 'prague', 'budapest', 'warsaw', 'geneva', 'basel', 'bern', 'lausanne'];

// Shared function to check if event is in Australia
function isEventInAustralia(event) {
  // Check coordinates
  const lat = event.latitude || event.lat || null;
  const lng = event.longitude || event.lng || event.lon || null;
  
  if (lat !== null && lng !== null) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!isNaN(latNum) && !isNaN(lngNum)) {
      // Reject positive latitudes (northern hemisphere)
      if (latNum > 0) return false;
      // Check Australia bounds: lat -44 to -10, lng 113 to 154
      if (latNum < -44 || latNum > -10 || lngNum < 113 || lngNum > 154) return false;
    }
  }
  
  // Check suburb
  if (event.suburb) {
    const suburbLower = String(event.suburb).toLowerCase().trim();
    if (suburbLower === 'zurich' || NON_AUSTRALIAN_CITIES.includes(suburbLower)) return false;
  }
  
  // Check title/description for Zurich
  const titleDesc = `${event.title || ''} ${event.description || ''}`.toLowerCase();
  if (titleDesc.includes('zurich')) return false;
  
  // Check state
  if (event.state) {
    const stateUpper = String(event.state).toUpperCase().trim();
    if (!AUSTRALIAN_STATES.includes(stateUpper)) return false;
  }
  
  return true;
}

async function persistPerplexityEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }

  // Filter: Only persist Australian events
  const filteredEvents = events.filter(isEventInAustralia);
  
  if (filteredEvents.length === 0) {
    return;
  }
  
  if (filteredEvents.length < events.length) {
    console.log(`🌏 Filtered out ${events.length - filteredEvents.length} non-Australian events before persistence`);
  }

  const client = await pool.connect();

  try {
    for (const event of filteredEvents) {
      const eventId = event.id || generateDeterministicEventId(event);
      const embeddingText = buildEmbeddingText(event);

      let embeddingVector = null;
      if (embeddingText) {
        try {
          embeddingVector = await getEmbedding(embeddingText);
        } catch (err) {
          console.error(`⚠️ Failed to create embedding for ${eventId}:`, err.message);
        }
      }

      const insertQuery = `
        INSERT INTO events (
          id,
          title,
          description,
          start_date,
          end_date,
          suburb,
          state,
          postcode,
          latitude,
          longitude,
          category,
          website,
          image_url,
          host,
          embedding
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (id) DO UPDATE SET
          title = COALESCE(EXCLUDED.title, events.title),
          description = COALESCE(EXCLUDED.description, events.description),
          start_date = COALESCE(EXCLUDED.start_date, events.start_date),
          end_date = COALESCE(EXCLUDED.end_date, events.end_date),
          suburb = COALESCE(EXCLUDED.suburb, events.suburb),
          state = COALESCE(EXCLUDED.state, events.state),
          postcode = COALESCE(EXCLUDED.postcode, events.postcode),
          latitude = COALESCE(EXCLUDED.latitude, events.latitude),
          longitude = COALESCE(EXCLUDED.longitude, events.longitude),
          category = COALESCE(EXCLUDED.category, events.category),
          website = COALESCE(EXCLUDED.website, events.website),
          image_url = COALESCE(EXCLUDED.image_url, events.image_url),
          host = COALESCE(EXCLUDED.host, events.host),
          embedding = COALESCE(EXCLUDED.embedding, events.embedding)
      `;

      const values = [
        eventId,
        event.title || null,
        event.description || null,
        normalizeEventDate(event.start_date),
        normalizeEventDate(event.end_date),
        event.suburb || null,
        event.state || null,
        event.postcode || null,
        sanitizeNumber(event.latitude),
        sanitizeNumber(event.longitude),
        Array.isArray(event.category) ? event.category : (event.category ? [event.category] : null),
        event.website || null,
        event.image_url || null,
        event.host || 'perplexity',
        embeddingVector ? toPgVectorString(embeddingVector) : null
      ];

      await client.query(insertQuery, values);
    }
  } catch (err) {
    console.error('❌ Failed to persist Perplexity events:', err.message);
  } finally {
    client.release();
  }
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

    let searchQuery = `Find 5-8 upcoming events related to "${query}" in Australia ONLY.`;

    // CRITICAL: Explicitly restrict to Australia with examples of what NOT to include
    searchQuery += ` 

CRITICAL REQUIREMENTS:
- ONLY return events located in Australia
- Events MUST be in one of these Australian states/territories: NSW, VIC, QLD, WA, SA, TAS, ACT, or NT
- DO NOT include events from ANY other country (USA, UK, Canada, New Zealand, Europe, Asia, etc.)
- DO NOT include events from cities like: Zurich, London, Paris, New York, Tokyo, Berlin, Madrid, Rome, Amsterdam, Vienna, Stockholm, Oslo, Copenhagen, Helsinki, Dublin, Brussels, Lisbon, Athens, Prague, Budapest, Warsaw, Geneva, Basel, Bern, Lausanne, or any other non-Australian city
- Coordinates MUST be within Australia bounds: latitude between -44 and -10 (southern hemisphere), longitude between 113 and 154 (eastern hemisphere)
- If an event is in Zurich, Switzerland, London, UK, or any other non-Australian location, DO NOT include it`;

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
      searchQuery += ` Prioritize events near ${location.suburb || location.state || 'Australia'}, Australia.`;
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

CRITICAL: Only include events from Australia (states: NSW, VIC, QLD, WA, SA, TAS, ACT, NT).
DO NOT include events from Zurich, Switzerland or any other non-Australian location.
Coordinates must be within Australia: latitude between -44 and -10, longitude between 113 and 154.
If you find events in Zurich, London, Paris, New York, or any other non-Australian city, DO NOT include them in the results.
`;


    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: 'Return ONLY valid, complete JSON arrays. Never add text before/after. Omit image_url fields. CRITICAL: Only return events from Australia (states: NSW, VIC, QLD, WA, SA, TAS, ACT, NT). STRICTLY EXCLUDE all events from other countries including but not limited to: USA, UK, Canada, New Zealand, Switzerland (Zurich), Germany, France, Spain, Italy, Netherlands, Belgium, Austria, Sweden, Norway, Denmark, Finland, Poland, Greece, Ireland, Czech Republic, Hungary, Romania, Portugal, and any other non-Australian country. If coordinates are provided, they MUST be within Australia bounds: latitude -44 to -10, longitude 113 to 154. Reject any event with coordinates outside these bounds or in non-Australian cities.'
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
        timeout: 10000, // 10s timeout (shorter than wrapper timeout to prevent axios timeout errors)
      }
    );

    const content = response.data.choices[0].message.content;
    return parsePerplexityResponse(content, query, startDate);
  } catch (err) {
    // Handle timeout errors silently - they're expected and will fall back to database
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      // Timeout is expected, silently return null to fall back to database results
      return null;
    }
    // Only log non-timeout errors (API errors, network issues, etc.)
    if (err.response) {
      // API returned an error response
      console.warn(`⚠️ Perplexity API error (${err.response.status}): ${err.response.statusText}`);
    } else if (err.request && !err.code) {
      // Request was made but no response received (network issue)
      console.warn('⚠️ Perplexity request failed: No response received');
    } else {
      // Other errors
      console.warn(`⚠️ Perplexity search error: ${err.message}`);
    }
    return null;
  }
}


async function searchWithTimeout(query, category, location, startDate) {
  // Use a slightly longer timeout than axios to ensure wrapper timeout wins
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      // Timeout reached - silently return null to fall back to database
      resolve(null);
    }, 11000); // 11s timeout (longer than axios 10s, ensures wrapper timeout always wins)
  });

  const searchPromise = searchWithPerplexity(query, category, location, startDate);

  // Race between search and timeout - whichever finishes first wins
  return Promise.race([searchPromise, timeoutPromise]);
}


function parsePerplexityResponse(content, originalQuery, startDate) {
  try {
    const now = new Date();
    const filterDate = startDate ? new Date(startDate) : now;

    let events = [];

    // ==============================
    // AUSTRALIA FILTERING FUNCTION
    // ==============================
    // Negative indicators (other countries and cities) - defined before function
    const nonAustralianIndicators = [
      // USA
      'united states', 'usa', 'us', 'new york', 'california', 'texas', 'florida',
      'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio',
      'san diego', 'dallas', 'san jose', 'austin', 'jacksonville', 'san francisco',
      // UK
      'london', 'england', 'uk', 'united kingdom', 'britain', 'scotland', 'wales',
      'manchester', 'birmingham', 'liverpool', 'leeds', 'glasgow', 'edinburgh',
      // Canada
      'canada', 'toronto', 'vancouver', 'montreal', 'ontario', 'british columbia',
      'calgary', 'ottawa', 'edmonton', 'winnipeg', 'quebec',
      // New Zealand
      'new zealand', 'auckland', 'wellington', 'christchurch', 'dunedin',
      // Asia
      'singapore', 'malaysia', 'indonesia', 'thailand', 'philippines',
      'japan', 'tokyo', 'osaka', 'kyoto', 'yokohama', 'china', 'beijing', 'shanghai',
      'hong kong', 'taiwan', 'taipei', 'india', 'mumbai', 'delhi', 'bangalore',
      'kolkata', 'chennai', 'hyderabad', 'pune', 'south korea', 'seoul', 'busan',
      // Europe
      'france', 'paris', 'lyon', 'marseille', 'toulouse', 'nice', 'germany', 'berlin',
      'munich', 'hamburg', 'frankfurt', 'cologne', 'stuttgart', 'spain', 'madrid',
      'barcelona', 'valencia', 'seville', 'italy', 'rome', 'milan', 'naples', 'turin',
      'palermo', 'genoa', 'bologna', 'florence', 'venice', 'switzerland', 'zurich',
      'geneva', 'basel', 'bern', 'lausanne', 'netherlands', 'amsterdam', 'rotterdam',
      'the hague', 'utrecht', 'eindhoven', 'belgium', 'brussels', 'antwerp', 'ghent',
      'portugal', 'lisbon', 'porto', 'austria', 'vienna', 'salzburg', 'graz',
      'sweden', 'stockholm', 'gothenburg', 'norway', 'oslo', 'bergen', 'denmark',
      'copenhagen', 'aarhus', 'finland', 'helsinki', 'poland', 'warsaw', 'krakow',
      'greece', 'athens', 'thessaloniki', 'ireland', 'dublin', 'cork', 'czech',
      'prague', 'hungary', 'budapest', 'romania', 'bucharest',
      // Latin America
      'brazil', 'sao paulo', 'rio de janeiro', 'brasilia', 'salvador', 'fortaleza',
      'belo horizonte', 'mexico', 'mexico city', 'guadalajara', 'monterrey', 'puebla',
      'argentina', 'buenos aires', 'cordoba', 'rosario', 'chile', 'santiago', 'valparaiso',
      'colombia', 'bogota', 'medellin', 'cali', 'peru', 'lima', 'venezuela', 'caracas',
      // Middle East
      'dubai', 'abu dhabi', 'riyadh', 'jeddah', 'tel aviv', 'jerusalem', 'istanbul',
      'ankara', 'cairo', 'alexandria',
      // Africa
      'south africa', 'johannesburg', 'cape town', 'durban', 'pretoria', 'cairo',
      'lagos', 'nairobi', 'casablanca'
    ];
    
    function isEventInAustralia(event) {
      // FIRST: Check coordinates - this is the most reliable check
      // Australia bounds: lat -10 to -44 (southern hemisphere), lng 113 to 154 (eastern hemisphere)
      // Check all possible locations: top-level, location object, address object, place object
      const lat = event.latitude || event.lat ||
                  event.location?.latitude || event.location?.lat || 
                  event.address?.latitude || event.address?.lat ||
                  event.place?.latitude || event.place?.lat || null;
      const lng = event.longitude || event.lng || event.lon ||
                  event.location?.longitude || event.location?.lng || 
                  event.location?.lon ||
                  event.address?.longitude || event.address?.lng || event.address?.lon ||
                  event.place?.longitude || event.place?.lng || event.place?.lon || null;
      
      // Track if coordinates are in Australia
      let coordinatesInAustralia = false;
      if (lat !== null && lng !== null) {
        const latNum = Number(lat);
        const lngNum = Number(lng);
        // If coordinates are valid numbers, check bounds strictly
        if (!isNaN(latNum) && !isNaN(lngNum)) {
          // Australia's bounds: lat -44 to -10 (southern hemisphere, ALL NEGATIVE), lng 113 to 154 (eastern hemisphere)
          // Reject if:
          // - Latitude is positive (northern hemisphere) - Australia is in southern hemisphere
          // - Latitude is outside -44 to -10 range
          // - Longitude is outside 113 to 154 range
          
          // Reject positive latitudes (northern hemisphere) immediately
          if (latNum > 0) return false;
          
          // Check if coordinates are within Australia bounds
          if (latNum >= -44 && latNum <= -10 && lngNum >= 113 && lngNum <= 154) {
            coordinatesInAustralia = true;
          } else {
            return false;
          }
        }
      }

      // SECOND: Check suburb/city name directly for known non-Australian cities
      // Check all possible locations: top-level, location object, address object, place object
      const suburb = event.suburb || event.city ||
                     event.location?.suburb || event.location?.city || 
                     event.address?.suburb || event.address?.city ||
                     event.place?.suburb || event.place?.city || null;
      
      if (suburb) {
        const suburbLower = String(suburb).toLowerCase().trim();
        
        // Reject Zurich and other non-Australian cities
        if (suburbLower === 'zurich' || NON_AUSTRALIAN_CITIES.includes(suburbLower)) {
          return false;
        }
        
        // Check against extended non-Australian indicators
        const isNonAustralian = nonAustralianIndicators.some(indicator => {
          return suburbLower === indicator || suburbLower.includes(indicator) || indicator.includes(suburbLower);
        });
        if (isNonAustralian) return false;
      }

      // THIRD: Check state code
      // Check all possible locations: top-level, location object, address object, place object
      const state = event.state ||
                    event.location?.state || event.address?.state || event.place?.state || null;
      if (state) {
        const stateUpper = String(state).toUpperCase().trim();
        if (AUSTRALIAN_STATES.includes(stateUpper)) {
          return true;
        }
        if (stateUpper.length > 0) return false;
      }

      // FOURTH: Check location strings for Australian indicators
      const locationStr = JSON.stringify(event.location || event.address || event.place || '').toLowerCase();
      const titleDescStr = `${event.title || ''} ${event.description || ''}`.toLowerCase();
      const suburbStr = suburb ? String(suburb).toLowerCase() : '';
      const combinedStr = `${locationStr} ${titleDescStr} ${suburbStr}`;
      
      // Reject if "Zurich" appears anywhere
      if (combinedStr.includes('zurich')) return false;
      
      // Positive indicators
      const australianIndicators = [
        'australia', 'australian', 'sydney', 'melbourne', 'brisbane', 'perth', 
        'adelaide', 'hobart', 'darwin', 'canberra', 'nsw', 'vic', 'qld', 'wa', 
        'sa', 'tas', 'act', 'nt', 'new south wales', 'victoria', 'queensland',
        'western australia', 'south australia', 'tasmania', 'australian capital territory',
        'northern territory'
      ];
      
      // Reject if non-Australian indicators found
      if (nonAustralianIndicators.some(indicator => combinedStr.includes(indicator))) {
        return false;
      }
      
      // Accept if at least one positive indicator found
      const hasAustralianIndicator = australianIndicators.some(indicator => combinedStr.includes(indicator));
      const hasAustralianState = (state && AUSTRALIAN_STATES.includes(String(state).toUpperCase().trim()));
      
      if (coordinatesInAustralia || hasAustralianState || hasAustralianIndicator) {
        return true;
      }

      // Reject if no clear positive indicators
      return false;
    }

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

    // ==============================
    // FILTER AUSTRALIA-ONLY EVENTS
    // ==============================
    if (Array.isArray(events) && events.length > 0) {
      const beforeFilter = events.length;
      events = events.filter(isEventInAustralia);
      if (beforeFilter > events.length) {
        console.log(`🌏 Filtered out ${beforeFilter - events.length} non-Australian events from Perplexity response`);
      }
    }

    if (!Array.isArray(events) || events.length === 0) {
      console.warn("⚠️ No valid structured events found, returning NOT FOUND response.");

      // Return the same error format your main API uses
      return {
        error: "No upcoming events found",
        statusCode: 404,
        message: "No upcoming events match your search. Try different keywords or check back later for new events."
      };
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
      // Extract location from nested objects OR top-level event properties
      const loc = parseLocation(event.location || event.address || event.place);
      
      // Override with top-level properties if they exist (Perplexity sometimes puts them at top level)
      const finalSuburb = event.suburb || event.city || loc.suburb;
      const finalState = event.state || loc.state;
      const finalPostcode = event.postcode || event.postal_code || loc.postcode;
      const finalLatitude = event.latitude || event.lat || loc.latitude;
      const finalLongitude = event.longitude || event.lng || event.lon || loc.longitude;

      // Detect categories first
      const categories = detectCategories([
        event.category,
        event.title,
        event.description
      ]);

      // ALWAYS use our reliable image library
      // Ignore any image_url from Perplexity as they're often fake
      const imageUrl = getRandomImageForCategory(categories[0]);


      const deterministicId = event.id || generateDeterministicEventId({
        ...event,
        suburb: finalSuburb,
        state: finalState
      }, index);

      return {
        id: deterministicId,
        title: event.title?.trim() || "Untitled Event",
        description: event.description?.trim() || "",
        start_date: event.start_date || event.date || null,
        end_date: event.end_date || null,
        suburb: finalSuburb,
        state: finalState,
        postcode: finalPostcode,
        latitude: finalLatitude,
        longitude: finalLongitude,
        category: categories,
        image_url: imageUrl,
        website: event.website || event.url || null,
        source: "perplexity",
        similarity: 0,
        distance_km: null
      };
    });

    // ==============================
    // FILTER UPCOMING EVENTS & FINAL AUSTRALIA CHECK
    // ==============================
    const upcoming = formattedEvents.filter(ev => {
      // Final safety check using shared function
      if (!isEventInAustralia(ev)) return false;
      
      // Date filter
      if (!ev.start_date) return true;
      try {
        const eventDate = new Date(ev.start_date);
        return isNaN(eventDate.getTime()) || eventDate >= filterDate;
      } catch {
        return true;
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

    // Check if we should try Perplexity as a fallback
    // Only use Perplexity if database has NO results, or similarity is very poor (> 0.25)
    const shouldTryPerplexity = result.rows.length === 0 || (embedding && result.rows[0]?.similarity > 0.25);

    if (shouldTryPerplexity && perplexityPromise) {
      // We already started Perplexity search - just wait for it
      // console.log('⏳ Waiting for Perplexity results (already in progress)...');
      const perplexityResults = await perplexityPromise;

      // Handle Perplexity results (could be array, null, or error object)
      if (perplexityResults && Array.isArray(perplexityResults) && perplexityResults.length > 0) {
        // Results are already filtered in parsePerplexityResponse
        console.log(`✅ Perplexity returned ${perplexityResults.length} Australian events`);
        await persistPerplexityEvents(perplexityResults);
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
      } else if (perplexityResults?.statusCode === 404) {
        // Perplexity explicitly returned 404 (no events found)
        // Fall back to database results if available
        if (result.rows.length > 0) {
          console.log(`⚠️ Perplexity found no events, falling back to ${result.rows.length} database results`);
          // Continue to return database results below
        } else {
          // Both database and Perplexity have no results
          return res.status(404).json(perplexityResults);
        }
      } else {
        // Perplexity returned null (timeout or error) - silently fall back to database
        if (result.rows.length > 0) {
          // Database has results, use them (no need to log - this is expected behavior)
          // Continue to return database results below
        } else {
          // Perplexity timed out/failed AND database has no results
          return res.status(404).json({
            error: 'No upcoming events found',
            statusCode: 404,
            message: 'No upcoming events match your search. Try different keywords or check back later for new events.'
          });
        }
      }
      // If Perplexity failed/timed out but we have database results, fall through to return them
    } else if (result.rows.length === 0) {
      // No database results and no Perplexity search was initiated (no query provided)
      return res.status(404).json({
        error: 'No upcoming events found',
        statusCode: 404,
        message: 'No upcoming events match your search. Try different keywords or check back later for new events.'
      });
    }

    // Apply improved filtering logic (only if embedding exists)
    let finalResults = result.rows;

    if (embedding && result.rows.length > 0) {
      const bestSimilarity = result.rows[0].similarity;
      const hasExactKeywordMatch = result.rows.some(row => row.has_exact_keywords);

      if (hasExactKeywordMatch) {
        finalResults = result.rows.filter(row => row.has_exact_keywords);
      } else if (bestSimilarity < 0.08) {
        finalResults = result.rows.filter(row => row.similarity < 0.08);
      }
      // If no exact match and similarity >= 0.08, return all results (already set above)
      
      // Safety check: if filtering removed all results, fall back to original results
      if (finalResults.length === 0 && result.rows.length > 0) {
        console.log(`⚠️ Filtering removed all results, falling back to all ${result.rows.length} database results`);
        finalResults = result.rows;
      }
    }

    // Filter out non-Australian events from database results
    const beforeDbFilter = finalResults.length;
    finalResults = finalResults.filter(isEventInAustralia);
    
    if (beforeDbFilter > finalResults.length) {
      console.log(`🌏 Filtered out ${beforeDbFilter - finalResults.length} non-Australian events from database results`);
    }

    // Final safety check: if we still have no results, return 404
    if (finalResults.length === 0) {
      return res.status(404).json({
        error: 'No upcoming events found',
        statusCode: 404,
        message: 'No upcoming events match your search. Try different keywords or check back later for new events.'
      });
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


//     res.json({
//   results: finalResults.map(ev => ({
//     ...ev,
//     has_time: hasRealTime(ev.start_date) || hasRealTime(ev.end_date)
//   })),
//   pagination: {
//     currentPage: pageNum,
//     totalPages: totalPages,
//     totalResults: totalCount,
//     resultsPerPage: limitNum,
//     hasNextPage: pageNum < totalPages,
//     hasPreviousPage: pageNum > 1
//   }
// });

  } catch (err) {
    console.error('❌ Semantic search error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};


