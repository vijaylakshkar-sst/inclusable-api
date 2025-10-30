const pool = require('../dbconfig');
const stripe = require('../stripe');
const { sendNotificationToBusiness } = require("../hooks/notification");

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

  // Handle payment success
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const paymentIntentId = paymentIntent.id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Update transactions table
      await client.query(
        `UPDATE transactions SET status = 'succeeded' WHERE payment_intent_id = $1`,
        [paymentIntentId]
      );

      // 2. Update event_bookings table
      await client.query(`
        UPDATE event_bookings 
        SET status = 'confirmed' 
        WHERE id = (SELECT booking_id FROM transactions WHERE payment_intent_id = $1)
      `, [paymentIntentId]);

  
      const bookingData = await client.query('SELECT * FROM transactions WHERE payment_intent_id = $1', [paymentIntentId]);
      const bookingFinalData = bookingData.rows[0];

      const booking_id = bookingFinalData.booking_id;
       // 3️⃣ Fetch event + user data for notification
      const userData = await client.query('SELECT * FROM users WHERE id = $1', [bookingFinalData.user_id]);
      const user = userData.rows[0];

      const eventData = await client.query(
        `SELECT id, event_name, user_id AS business_user_id
         FROM company_events
         WHERE id = (
           SELECT event_id FROM event_bookings WHERE id = $1
         )`,
        [booking_id]
      );

      const eventRow = eventData.rows[0];

      // 4️⃣ Send notification if event exists
      if (eventRow) {
        const dynamicData = {
          title: 'New Booking Received!',
          body: `${user.full_name} just booked ${eventRow.event_name}.`,
          type: 'Booking',
          target: 'Company',
          id: String(eventRow.id),
          booking_id: String(booking_id),
        };

        await sendNotificationToBusiness({
          businessUserId: eventRow.business_user_id,
          title: dynamicData.title,
          message: dynamicData.body,
          type: dynamicData.type,
          target: dynamicData.target,
          id: dynamicData.id,
          booking_id: dynamicData.booking_id,
        });

        console.log(`📩 Notification sent to business user ${eventRow.business_user_id}`);
      }


      await client.query('COMMIT');
      console.log('✅ Stripe payment succeeded and booking updated');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Webhook DB update failed:', err.message);
    } finally {
      client.release();
    }
  }

  res.json({ received: true });
};