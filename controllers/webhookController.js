const pool = require('../dbconfig');
const stripe = require('../stripe');
const { sendNotificationToBusiness,sendNotificationToDriver } = require("../hooks/notification");
const BASE_IMAGE_URL = process.env.BASE_IMAGE_URL;
// exports.handleStripeWebhook = async (req, res) => {
//   const sig = req.headers['stripe-signature'];
//   const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

//   let event;

//   try {
//     event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
//   } catch (err) {
//     console.error('❌ Webhook signature verification failed:', err.message);
//     return res.status(400).send(`Webhook Error: ${err.message}`);
//   }

//   const client = await pool.connect();

//   try {
//     if (event.type === 'payment_intent.succeeded') {
//       const paymentIntent = event.data.object;
//       const paymentIntentId = paymentIntent.id;

//       await client.query('BEGIN');

//       // ✅ 1. Mark transaction as succeeded
//       await client.query(
//         `UPDATE transactions SET status = 'succeeded' WHERE payment_intent_id = $1`,
//         [paymentIntentId]
//       );

//       // ✅ 2. Confirm booking
//       await client.query(`
//         UPDATE event_bookings 
//         SET status = 'confirmed' 
//         WHERE id = (SELECT booking_id FROM transactions WHERE payment_intent_id = $1)
//       `, [paymentIntentId]);

//       // ✅ 3. Fetch booking + user + event
//       const bookingData = await client.query('SELECT * FROM transactions WHERE payment_intent_id = $1', [paymentIntentId]);
//       const bookingFinalData = bookingData.rows[0];

//       const booking_id = bookingFinalData.booking_id;

//       const userData = await client.query('SELECT * FROM users WHERE id = $1', [bookingFinalData.user_id]);
//       const user = userData.rows[0];

//       const eventData = await client.query(
//         `SELECT id, event_name, user_id AS business_user_id
//          FROM company_events
//          WHERE id = (
//            SELECT event_id FROM event_bookings WHERE id = $1
//          )`,
//         [booking_id]
//       );

//       const eventRow = eventData.rows[0];

//       // ✅ 4. Send notification
//       if (eventRow) {
//         const dynamicData = {
//           title: 'New Booking Received!',
//           body: `${user.full_name} just booked ${eventRow.event_name}.`,
//           type: 'Booking',
//           target: 'Company',
//           id: String(eventRow.id),
//           booking_id: String(booking_id),
//         };

//         await sendNotificationToBusiness({
//           businessUserId: eventRow.business_user_id,
//           title: dynamicData.title,
//           message: dynamicData.body,
//           type: dynamicData.type,
//           target: dynamicData.target,
//           id: dynamicData.id,
//           booking_id: dynamicData.booking_id,
//         });

//         console.log(`📩 Notification sent to business user ${eventRow.business_user_id}`);
//       }

//       await client.query('COMMIT');
//       console.log('✅ Stripe payment succeeded and booking confirmed');
//     }

//     // 🆕 HANDLE PAYMENT FAILURE — restore seats
//     else if (event.type === 'payment_intent.payment_failed') {
//       const paymentIntent = event.data.object;
//       const paymentIntentId = paymentIntent.id;

//       await client.query('BEGIN');

//       // 🆕 Get booking & event details
//       const txnData = await client.query(
//         `SELECT booking_id, event_id 
//          FROM transactions 
//          WHERE payment_intent_id = $1`,
//         [paymentIntentId]
//       );

//       if (txnData.rows.length > 0) {
//         const { booking_id, event_id } = txnData.rows[0];

//         // 🆕 Get number of tickets booked
//         const bookingInfo = await client.query(
//           `SELECT number_of_tickets FROM event_bookings WHERE id = $1`,
//           [booking_id]
//         );

//         const number_of_tickets = bookingInfo.rows[0]?.number_of_tickets || 0;

//         // 🆕 Restore seats
//         await client.query(
//           `UPDATE company_events 
//            SET total_available_seats = total_available_seats + $1,
//                updated_at = NOW()
//            WHERE id = $2`,
//           [number_of_tickets, event_id]
//         );

//         // 🆕 Mark booking & transaction as failed
//         await client.query(
//           `UPDATE event_bookings SET status = 'failed' WHERE id = $1`,
//           [booking_id]
//         );

//         await client.query(
//           `UPDATE transactions SET status = 'failed' WHERE payment_intent_id = $1`,
//           [paymentIntentId]
//         );

//         console.log(`❌ Payment failed — restored ${number_of_tickets} seats for event ${event_id}`);
//       }

//       await client.query('COMMIT');
//     }

//     // 🆕 Optional: Handle other cleanup events like canceled, timed out
//     else if (event.type === 'payment_intent.canceled') {
//       const paymentIntent = event.data.object;
//       const paymentIntentId = paymentIntent.id;

//       await client.query('BEGIN');

//       const txnData = await client.query(
//         `SELECT booking_id, event_id FROM transactions WHERE payment_intent_id = $1`,
//         [paymentIntentId]
//       );

//       if (txnData.rows.length > 0) {
//         const { booking_id, event_id } = txnData.rows[0];

//         const bookingInfo = await client.query(
//           `SELECT number_of_tickets FROM event_bookings WHERE id = $1`,
//           [booking_id]
//         );

//         const number_of_tickets = bookingInfo.rows[0]?.number_of_tickets || 0;

//         // Restore seats
//         await client.query(
//           `UPDATE company_events 
//         SET total_available_seats = total_available_seats + $1,
//             updated_at = NOW()
//         WHERE id = $2`,
//           [number_of_tickets, event_id]
//         );

//         // Update statuses
//         await client.query(
//           `UPDATE event_bookings SET status = 'cancelled' WHERE id = $1`,
//           [booking_id]
//         );

//         await client.query(
//           `UPDATE transactions SET status = 'cancelled' WHERE payment_intent_id = $1`,
//           [paymentIntentId]
//         );

//         console.log(`🚫 Payment canceled — restored ${number_of_tickets} seats for event ${event_id}`);
//       }

//       await client.query('COMMIT');
//     }

//   } catch (err) {
//     await client.query('ROLLBACK');
//     console.error('❌ Webhook DB update failed:', err.message);
//   } finally {
//     client.release();
//   }

//   res.json({ received: true });
// };

const generateBookingCode = () => {
  return "INEPS" + Date.now() + Math.floor(Math.random() * 100000);
};

exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const client = await pool.connect();

  try {
    // ============================
    // ✅ PAYMENT SUCCEEDED
    // ============================
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const paymentIntentId = paymentIntent.id;

      await client.query('BEGIN');

      // 1️⃣ Update transaction
      await client.query(
        `UPDATE transactions
         SET status = 'succeeded'
         WHERE payment_intent_id = $1`,
        [paymentIntentId]
      );

      const bookingCode = generateBookingCode();

      // 2️⃣ Confirm booking
      const bookingRes = await client.query(
        `
        UPDATE event_bookings
        SET status = 'confirmed',
            booking_code = $2
        WHERE id = (
          SELECT booking_id FROM transactions WHERE payment_intent_id = $1
        )
        RETURNING id, user_id, event_id, booking_code
        `,
        [paymentIntentId, bookingCode]
      );
console.log(bookingRes.rows[0]);

      if (!bookingRes.rows.length) {
        throw new Error('Booking not found for payment');
      }

      const { id: booking_id, user_id, event_id } = bookingRes.rows[0];

      // 3️⃣ Fetch user + event for notification
      const userRes = await client.query(
        `SELECT full_name FROM users WHERE id = $1`,
        [user_id]
      );

      const eventRes = await client.query(
        `SELECT id, event_name, user_id AS business_user_id
         FROM company_events WHERE id = $1`,
        [event_id]
      );

      if (eventRes.rows.length) {
        await sendNotificationToBusiness({
          businessUserId: eventRes.rows[0].business_user_id,
          title: 'New Booking Received!',
          message: `${userRes.rows[0].full_name} just booked ${eventRes.rows[0].event_name}.`,
          type: 'Booking',
          target: 'Company',
          id: String(eventRes.rows[0].id),
          booking_id: String(booking_id),
        });
      }

      await client.query('COMMIT');
      console.log('✅ Payment succeeded → booking confirmed');
    }

    // ============================
    // ❌ PAYMENT FAILED
    // ============================
    else if (event.type === 'payment_intent.payment_failed') {
      const paymentIntentId = event.data.object.id;

      await client.query('BEGIN');

      await client.query(
        `UPDATE transactions SET status = 'failed'
         WHERE payment_intent_id = $1`,
        [paymentIntentId]
      );

      await client.query(
        `UPDATE event_bookings
         SET status = 'failed'
         WHERE id = (
           SELECT booking_id FROM transactions WHERE payment_intent_id = $1
         )`,
        [paymentIntentId]
      );

      await client.query('COMMIT');
      console.log('❌ Payment failed → booking marked failed');
    }

    // ============================
    // 🚫 PAYMENT CANCELED
    // ============================
    else if (event.type === 'payment_intent.canceled') {
      const paymentIntentId = event.data.object.id;

      await client.query('BEGIN');

      await client.query(
        `UPDATE transactions SET status = 'cancelled'
         WHERE payment_intent_id = $1`,
        [paymentIntentId]
      );

      await client.query(
        `UPDATE event_bookings
         SET status = 'cancelled'
         WHERE id = (
           SELECT booking_id FROM transactions WHERE payment_intent_id = $1
         )`,
        [paymentIntentId]
      );

      await client.query('COMMIT');
      console.log('🚫 Payment cancelled → booking cancelled');
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Webhook DB update failed:', err.message);
  } finally {
    client.release();
  }

  res.json({ received: true });
};


exports.handleCabBookingWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("⚠️ Webhook signature verification failed");
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const intent = event.data.object;

  switch (event.type) {
    case "payment_intent.succeeded":
      console.log("💰 Ride payment captured:", intent.id);

    const bookingData =  await pool.query(
        `UPDATE cab_bookings
         SET payment_status='paid'
         WHERE payment_intent_id=$1
         RETURNING id, user_id, driver_id, status, payment_status, created_at, updated_at, deleted_at`,
        [intent.id]
      );

      const booking = bookingData.rows[0];
      const driverId = booking.driver_id;

      const driverResult = await client.query(
        'SELECT id,user_id FROM drivers WHERE id = $1 LIMIT 1',
        [driverId]
      );

      if (driverResult.rowCount === 0) {
        return res.status(404).json({
          status: false,
          message: 'Driver not found for this user'
        });
      }

      const driver_user_id = driverResult.rows[0].user_id;


      if (driverId) {
        await sendNotificationToDriver({
          driverUserId: driver_user_id,
          title: 'Payment recieved!',
          message: `Booking Payment is recieved.`,
          type: 'Booking',
          booking_id: booking.id,
          image_url: `${BASE_IMAGE_URL}/icons/check-xmark.png`,
          bg_color: '#DF1D17',
          data: {
            screen: 'BookingDetails',
            sound: 'default',
          }
        });
      }

      break;

    case "payment_intent.canceled":
      console.log("❌ Payment hold released:", intent.id);

      await pool.query(
        `UPDATE cab_bookings
         SET payment_status='refunded'
         WHERE payment_intent_id=$1`,
        [intent.id]
      );

      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.sendStatus(200);
};