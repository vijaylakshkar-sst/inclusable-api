const pool = require('../dbconfig');
const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK (only once)
if (!admin.apps.length) {
  const serviceAccount = require(path.join(__dirname, '../inclusable-firebase.json'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

/**
 * Send notification to all users
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.message
 * @param {string} [params.type='system']
 * @param {string} [params.target='user'] - default: 'user'
 */
exports.sendNotification = async ({
  title,
  message,
  type = 'Event',
  target = 'NDIS Member', // or 'driver'
  id = null
}) => {
  if (!title || !message) {
    console.error('❌ Notification Error: Missing required fields (title, message)');
    return;
  }

  const client = await pool.connect();

  try {
    console.log('🚀 Fetching all user FCM tokens...');

    // Step 1️⃣: Get all user FCM tokens
    const fcmResult = await client.query(
        `
        SELECT id, fcm_token 
        FROM users 
        WHERE fcm_token IS NOT NULL 
          AND fcm_token <> '' 
          AND role = $1
          AND deleted_at IS NULL
        `,
        [target]
      );

    const users = fcmResult.rows;
    if (users.length === 0) {
      console.warn('⚠️ No users found with valid FCM tokens.');
      return;
    }

    console.log(`✅ Found ${users.length} users with FCM tokens.`);

    // Step 2️⃣: Insert notification for all users
    const insertPromises = users.map((user) =>
      client.query(
        `
        INSERT INTO notifications (user_id, title, message, type, target,company_event_id)
        VALUES ($1, $2, $3, $4, $5,$6)
        `,
        [user.id, title, message, type, target, id]
      )
    );
    await Promise.all(insertPromises);
    console.log('✅ Notifications stored in DB for all users.');

    // Step 3️⃣: Prepare FCM payload for bulk sending
    const tokens = users.map((u) => u.fcm_token);
    const payload = {
      notification: {
        title,
        body: message,
      },
      data: {
        type,
        target,
        id: String(id || ''),
      },
      tokens, // sending to all tokens
    };
    console.log(payload);

    // Step 4️⃣: Send push notification in bulk
    const response = await admin.messaging().sendEachForMulticast(payload);
    console.log(response);

    response.responses.forEach((res, idx) => {
      if (!res.success) {
        console.error(`❌ Token failed: ${tokens[idx]} - ${res.error.message}`);
      }
    });

    console.log(
      `✅ Push notifications sent to all users. Success: ${response.successCount}, Failure: ${response.failureCount}`
    );

  } catch (err) {
    console.error('❌ Notification Error:', err.message);
  } finally {
    client.release();
  }
};

exports.sendNotificationToBusiness = async ({
  businessUserId,
  title,
  message,
  type = 'Booking',
  target = 'Company',
  id = '',
  booking_id=''
}) => {
  if (!title || !message || !businessUserId) {
    console.error('❌ Notification Error: Missing required fields.');
    return;
  }

  const client = await pool.connect();

  try {
    console.log(`🚀 Fetching FCM token for business user ${businessUserId}...`);
    const fcmResult = await client.query(
      `SELECT id, fcm_token FROM users WHERE id = $1 AND fcm_token IS NOT NULL AND fcm_token <> ''`,
      [businessUserId]
    );

    if (fcmResult.rows.length === 0) {
      console.warn(`⚠️ No valid FCM token found for business user ID ${businessUserId}`);
      return;
    }

    const user = fcmResult.rows[0];
    const token = user.fcm_token;

    // Insert notification in DB
    await client.query(
      `
      INSERT INTO notifications (user_id, title, message, type, target, company_event_id,booking_id)
      VALUES ($1, $2, $3, $4, $5, $6,$7)
      `,
      [businessUserId, title, message, type, target, id,booking_id]
    );
    console.log('✅ Notification stored in DB for business user.');

    // Build FCM payload
    const payload = {
      notification: {
        title,
        body: message,
      },
      data: {
        type: String(type),
        target: String(target),
        id: String(id),
        booking_id: String(booking_id),
      },
      token,
    };

    // Send push notification
    const response = await admin.messaging().send(payload);
    console.log(`✅ Notification sent to business user ID ${businessUserId}`, response);

  } catch (err) {
    console.error('❌ Business Notification Error:', err.message);
  } finally {
    client.release();
  }
};


exports.sendNotificationToDriver = async ({
  driverUserId, // The driver’s user_id (from users table)
  title,
  message,
  type = 'Booking',
  target = 'Driver',
  booking_id = '',
  image_url = '',
  bg_color = '#ffffff',
  data = {} // optional additional payload
}) => {  
  
  if (!title || !message || !driverUserId) {
    console.error('❌ Driver Notification Error: Missing required fields.');
    return;
  }

  const client = await pool.connect();

  try {
    console.log(`🚀 Fetching FCM token for driver user ID ${driverUserId}...`);

    // 1️⃣ Get FCM token for the driver user
    const fcmResult = await client.query(
      `SELECT id, fcm_token FROM users 
       WHERE id = $1 
         AND fcm_token IS NOT NULL 
         AND fcm_token <> '' 
         AND deleted_at IS NULL
       LIMIT 1`,
      [driverUserId]
    );

    if (fcmResult.rowCount === 0) {
      console.warn(`⚠️ No valid FCM token found for driver user ID ${driverUserId}`);
      return;
    }

    const driver = fcmResult.rows[0];
    const token = driver.fcm_token;

    // 2️⃣ Store notification in DB
    await client.query(
      `
      INSERT INTO notifications (user_id, title, message, type, target, booking_id,image_url,bg_color)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [driverUserId, title, message, type, target, booking_id, image_url, bg_color]
    );

    console.log(`✅ Notification saved in DB for driver user ID ${driverUserId}`);

    // 3️⃣ Build FCM payload
    const payload = {
      notification: {
        title,
        body: message,
      },
      data: {
        type: String(type),
        target: String(target),
        booking_id: String(booking_id || ''),
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {})
      },
      token,
    };

    // 4️⃣ Send push notification
    const response = await admin.messaging().send(payload);
    console.log(`✅ Push notification sent to driver ID ${driverUserId}`, response);

  } catch (err) {
    console.error('❌ Driver Notification Error:', err.message);
  } finally {
    client.release();
  }
};

exports.sendNotificationToUser = async ({
  userId,
  title,
  message,
  type = 'Booking',
  target = 'NDIS Member',
  booking_id = '',
  data = {}
}) => {
  if (!title || !message || !userId) {
    console.error('❌ Notification Error: Missing required fields.');
    return;
  }

  const client = await pool.connect();

  try {
    console.log(`🚀 Fetching FCM token for user ID ${userId}...`);

    // 1️⃣ Get FCM token for this user
    const fcmResult = await client.query(
      `SELECT id, fcm_token FROM users 
       WHERE id = $1 
         AND fcm_token IS NOT NULL 
         AND fcm_token <> '' 
         AND deleted_at IS NULL
       LIMIT 1`,
      [userId]
    );

    if (fcmResult.rowCount === 0) {
      console.warn(`⚠️ No valid FCM token found for user ID ${userId}`);
      return;
    }

    const user = fcmResult.rows[0];
    const token = user.fcm_token;

    // 2️⃣ Store notification in DB
    await client.query(
      `
      INSERT INTO notifications (user_id, title, message, type, target, booking_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [userId, title, message, type, target, booking_id]
    );

    console.log(`✅ Notification saved in DB for user ID ${userId}`);

    // 3️⃣ Prepare FCM payload
    const payload = {
      notification: {
        title,
        body: message,
      },
      data: {
        type: String(type),
        target: String(target),
        booking_id: String(booking_id || ''),
        ...Object.entries(data).reduce((acc, [key, value]) => {
          acc[key] = String(value);
          return acc;
        }, {})
      },
      token,
    };

    // 4️⃣ Send notification via Firebase
    const response = await admin.messaging().send(payload);
    console.log(`✅ Push notification sent to user ID ${userId}`, response);

  } catch (err) {
    console.error('❌ Notification Error:', err.message);
  } finally {
    client.release();
  }
};