const fs = require('fs');
require('dotenv').config();
const axios = require('axios');


const pool = require('../dbconfig');

async function getEmbedding(text) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        model: 'text-embedding-ada-002',
        input: text,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );
    return response.data.data[0].embedding;
  } catch (err) {
    console.error('❌ Failed to generate embedding:', err.message);
    return null;
  }
}
function formatForEmbedding(event) {
  const {
    title,
    description,
    suburb,
    state,
    postcode,
    start_date,
    end_date,
    category,
    website,
    host,
  } = event;

  // Format date
  const startDate = new Date(start_date).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const endDate = new Date(end_date).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const categoryStr = category?.join(', ');

  return `
"${title}" is an event taking place in ${suburb}, ${state}, ${postcode}, hosted by ${host}. 

This event falls under the categories: ${categoryStr}. It is scheduled to run from ${startDate} to ${endDate}.

Description: ${description}

For more information, visit: ${website}
`.trim();
}

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

async function importEvents() {
  const data = JSON.parse(fs.readFileSync(__dirname + '/../public/events3.json', 'utf8'));

  const client = await pool.connect();
  try {
  for (const event of data) {

  const query = `
  INSERT INTO events (
    id, title, description, start_date, end_date, suburb, postcode,
    state, latitude, longitude, category, website, image_url, host,
    embedding
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15::vector
  )
  ON CONFLICT (id) DO UPDATE
  SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    suburb = EXCLUDED.suburb,
    postcode = EXCLUDED.postcode,
    state = EXCLUDED.state,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    category = EXCLUDED.category,
    website = EXCLUDED.website,
    image_url = EXCLUDED.image_url,
    host = EXCLUDED.host,
    embedding = EXCLUDED.embedding;
`;


      const embeddingInput = formatForEmbedding(event);
      const embedding = await getEmbedding(embeddingInput);
      console.log(embedding, "embedding");
      
      if (!embedding) {
        console.warn(`⚠️ Skipping event ${event.id} due to missing embedding`);
        continue;
      }
      console.log("Embedding length:", embedding.length);

      const values = [
        event.id,
        event.title,
        event.description,
        event.start_date,
        event.end_date,
        event.suburb,
        event.postcode,
        event.state,
        event.latitude,
        event.longitude,
        event.category,
        event.website,
        event.image_url,
        event.host,
        toPgVectorString(embedding)
      ];

      try {
        await client.query(query, values).then((res) => {
          console.log(res, "res");
        }).catch((err) => {
          console.log(err, "error");
        })
        console.log(`✅ Inserted: ${event.title}`);
        // count++;
      } catch (err) {
        console.error(`❌ Error inserting event: ${event.id} - ${err.message}`);
      }
    }

    console.log('🎉 All events processed.');
  } catch (err) {
    console.error('❌ General error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}



importEvents().catch(err => {
  console.error('❌ Unexpected crash:', err);
});


