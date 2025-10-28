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
  id=null
}) => {
  if (!title || !message) {
    console.error('❌ Notification Error: Missing required fields (title, message)');
    return;
  }

  const client = await pool.connect();

  try {
    console.log('🚀 Fetching all user FCM tokens...');

    // Step 1️⃣: Get all user FCM tokens
    const fcmResult = await client.query(`
      SELECT id, fcm_token FROM users WHERE fcm_token IS NOT NULL AND fcm_token <> ''
    `);

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
        INSERT INTO notifications (user_id, title, message, type, target)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [user.id, title, message, type, target]
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
        id
      },
      tokens, // sending to all tokens
    };

    // Step 4️⃣: Send push notification in bulk
    const response = await admin.messaging().sendEachForMulticast(payload);

    console.log(
      `✅ Push notifications sent to all users. Success: ${response.successCount}, Failure: ${response.failureCount}`
    );

  } catch (err) {
    console.error('❌ Notification Error:', err.message);
  } finally {
    client.release();
  }
};
